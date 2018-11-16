import { KubeConfig, Core_v1Api, Apps_v1beta2Api, Autoscaling_v1Api, V1beta2Deployment, V1Container, V1PodStatus } from '@kubernetes/client-node'
const cloneDeep = require("lodash.clonedeep")

import { Pod } from "../model/Pod"
import { Image } from "../model/Image"
import { Deployment } from "../model/Deployment"
import { ServerGroup } from "../model/ServerGroup"
import { ClusterSnapshot } from "../model/ClusterSnapshot"
import { Scaler } from "../model/Scaler"
import { ClusterRepository } from "../ClusterRepository"
import { Cache } from "../../Cache"

import * as eventModule from "../../events/EventModule"


import { call } from "../../dispatcher"

interface Api {
    setDefaultAuthentication(config: KubeConfig): void
}

export class KubernetesClusterRepository implements ClusterRepository {

    private namespacesCache: Cache<string, string[]> = new Cache(60)

    public static fromConfig(configFile: string, namespaces?: string[]): KubernetesClusterRepository {
        const config = new KubeConfig()
        config.loadFromFile(configFile)
        const configs = new Map()
        for (const contexts of config.getContexts()) {
            const clusterConfig = cloneDeep(config)
            clusterConfig.setCurrentContext(contexts.name)
            configs.set(contexts.name, clusterConfig)
        }
        return new KubernetesClusterRepository(configs, namespaces)
    }

    public constructor(
        public readonly configs: Map<string, KubeConfig>,
        private readonly allowedNamespaces: string[] | undefined
    ) { }

    get clusters(): string[] {
        return Array.from(this.configs.keys())
    }

    async namespaces(context: string): Promise<string[]> {
        return this.namespacesCache.calculate(context, async () => {
            const api = this.build(context, (server: string) => new Core_v1Api(server))
            const result = await api.listNamespace()
            return result.body.items
                .map(namespace => namespace.metadata.name)
                .filter(namespace => this.isNamespaceAllowed(namespace))
        })
    }

    async pods(group: ServerGroup): Promise<Pod[]> {
        const api = this.build(group.cluster, (server: string) => new Core_v1Api(server))
        const namespace = this.getNamespace(group)
        const result = await api.listNamespacedPod(namespace)
        return result.body.items.map(item => {
            const image = this.createImage(item.spec.containers)
            let restarts
            if (item.status.containerStatuses != undefined && item.status.containerStatuses.length >= 1) {
                restarts = item.status.containerStatuses[0].restartCount
            }
            const ready = this.isReady(item.status)
            return {
                name: item.metadata.name,
                image, restarts, ready
            }
        })
    }

    async deployments(cluster: ServerGroup): Promise<Deployment[]> {
        const api = this.build(cluster.cluster, (server: string) => new Apps_v1beta2Api(server))
        const namespace = this.getNamespace(cluster)
        const result = await api.listNamespacedDeployment(namespace)
        return result.body.items.map(item => {
            const image = this.createImage(item.spec.template.spec.containers)
            return {
                name: item.metadata.name,
                image
            }
        })
    }

    async scalers(group: ServerGroup): Promise<Scaler[]> {
        const api = this.build(group.cluster, (server: string) => new Autoscaling_v1Api(server))
        const namespace = this.getNamespace(group)
        const result = await api.listNamespacedHorizontalPodAutoscaler(namespace)
        return result.body.items.map(item => ({
            name: item.metadata.name,
            replicas: {
                current: item.status.currentReplicas,
                minimum: item.spec.minReplicas,
                maximum: item.spec.maxReplicas
            }
        }))
    }

    async updateDeployment(group: ServerGroup, deployment: Deployment, targetImage: Image): Promise<Deployment> {
        const api = this.build(group.cluster, (server: string) => new Apps_v1beta2Api(server))
        const namespace = this.getNamespace(group)
        const response = await api.readNamespacedDeployment(deployment.name, namespace)

        const target = this.minifyDeployment(response.body)
        target.spec.template.spec.containers[0].image = targetImage.url

        let result = await api.replaceNamespacedDeployment(deployment.name, namespace, target)

        return {
            name: result.body.metadata.name,
            image: this.createImage(result.body.spec.template.spec.containers)
        }
    }

    async takeSnapshot(group: ServerGroup): Promise<ClusterSnapshot> {
        const api = this.build(group.cluster, (server: string) => new Apps_v1beta2Api(server))
        const namespace = this.getNamespace(group)
        const result = await api.listNamespacedDeployment(namespace)
        return {
            deployments: result.body.items.map(d => ({
                name: d.metadata.name,
                data: this.minifyDeployment(d)
            }))
        }
    }

    async applySnapshot(group: ServerGroup, snapshot: ClusterSnapshot, ignoreImage: boolean): Promise<void> {
        const api = this.build(group.cluster, (server: string) => new Apps_v1beta2Api(server))
        const namespace = this.getNamespace(group)
        const result = await api.listNamespacedDeployment(namespace)

        const applied: string[] = []
        const errored: string[] = []
        for (const deployment of snapshot.deployments) {
            const current = result.body.items.find(d => d.metadata.name === deployment.name)
            const target = deployment.data as V1beta2Deployment
            if (ignoreImage && current !== undefined) {
                const image = this.createImage(current.spec.template.spec.containers)
                if (image !== undefined) {
                    target.spec.template.spec.containers[0].image = image.url
                }
            }
            if (this.needsUpdate(current, target)) {
                try {
                    await api.replaceNamespacedDeployment(deployment.name, namespace, target)
                    applied.push(`Deployment ${deployment.name}`)
                } catch (e) {
                    errored.push(`Deployment ${deployment.name}`)
                }
            }
        }
        if (applied.length + errored.length > 0) {
            call(eventModule.log)({
                message: `Applied Snapshots`,
                timestamp: Date.now(),
                topics: ["slack"],
                description: `Applied Snapshots in ${group.cluster} ∞ ${group.namespace}`,
                fields: [
                    ...errored.map(value => ({ value, title: "Failure" })),
                    ...applied.map(value => ({ value, title: "Success" })),
                ]
            })
        }
    }

    private getNamespace(group: ServerGroup): string {
        return group.namespace || "default"
    }

    private isNamespaceAllowed(namespace: string): boolean {
        return this.allowedNamespaces === undefined
            || this.allowedNamespaces.find(n => n === namespace) !== undefined
    }

    private isReady(status: V1PodStatus): boolean {
        const readyCondition = status.conditions && status.conditions.find(c => c.type === 'Ready')
        return readyCondition !== undefined && readyCondition.status === 'True'
    }

    private createImage(containers: Array<V1Container> | undefined): Image | undefined {
        if (containers !== undefined && containers.length >= 1) {
            const url = containers[0].image
            const imageAndUrl = url.split(/@|:/)
            const imageParts = imageAndUrl[0].split("/")
            const name = imageParts[imageParts.length - 1]
            return { url, name }
        }
        return undefined
    }

    private getConfig(cluster: string): KubeConfig {
        const config: KubeConfig | undefined = this.configs.get(cluster)
        if (config === undefined) {
            throw new Error(`Config for cluster ${cluster} could not be found`)
        }
        return config
    }

    private getServer(config: KubeConfig): string {
        return config.getCurrentCluster()!.server
    }

    private build<T extends Api>(cluster: string, apiProvider: (server: string) => T): T {
        const config: KubeConfig = this.getConfig(cluster)
        const api: T = apiProvider(this.getServer(config))
        api.setDefaultAuthentication(config)
        return api
    }

    private minifyDeployment(deployment: V1beta2Deployment): V1beta2Deployment {
        return {
            metadata: {
                name: deployment.metadata.name,
                namespace: deployment.metadata.namespace,
                annotations: deployment.metadata.annotations
            },
            spec: deployment.spec
        } as V1beta2Deployment
    }

    private needsUpdate(current: V1beta2Deployment | undefined, target: V1beta2Deployment): boolean {
        if (current === undefined) {
            return true
        }
        return JSON.stringify(this.minifyDeployment(target)) !== JSON.stringify(this.minifyDeployment(current))
    }
}
