import * as moment from 'moment'
import { call } from '../dispatcher'
import { Resource } from '../dispatcher/resource'
import { clusters, namespaces, pods } from '../cluster/ClusterModule'
import { pipelines, schedules } from '../jobs/JobsModule'
import { Config } from '../config'
import { list, tags, image } from '../images/ImageModule'

let config: Config | undefined
export function init(c: Config) {
    config = c
}

export class Module {
    @Resource({ path: '/' })
    public async index(): Promise<object> {
        const errors: string[] = []

        let clustersWithNamespaces = undefined
        try {
            const knownClusters: string[] = await call(clusters)()
            clustersWithNamespaces = []
            for (const cluster of knownClusters) {
                const knownNamespaces = await call(namespaces)({ cluster })
                clustersWithNamespaces.push({
                    name: cluster,
                    namespaces: knownNamespaces,
                })
            }
        } catch (e) {
            errors.push('Clusters could not be loaded: ' + e.message)
        }

        let jobsWithSchedules = undefined
        try {
            const knownPipelines = await call(pipelines)()
            jobsWithSchedules = []
            for (const pipeline of knownPipelines) {
                let knownSchedules = await call(schedules)(pipeline)
                let lastRun: string | undefined
                let nextRun: string | undefined
                if (knownSchedules !== undefined) {
                    if (knownSchedules.lastRun !== undefined) {
                        lastRun = moment(knownSchedules.lastRun).toISOString()
                    }
                    if (knownSchedules.nextRuns.length > 0) {
                        nextRun = moment(knownSchedules.nextRuns[0]).toISOString()
                    }
                }
                jobsWithSchedules.push({
                    pipeline,
                    lastRun,
                    nextRun,
                })
            }
        } catch (e) {
            errors.push('Jobs could not be loaded: ' + e.message)
        }

        let knownImages = undefined
        try {
            knownImages = await call(list)()
        } catch (e) {
            errors.push('Images could not be loaded: ' + e.message)
        }

        return {
            title: 'Spacegun ∞ Dashboard',
            clusters: clustersWithNamespaces,
            jobs: jobsWithSchedules,
            images: knownImages,
            config,
            version: process.env.VERSION,
            errors,
        }
    }

    @Resource({ path: '/pods/:cluster' })
    public async pods(params: { cluster: string }): Promise<object> {
        const cluster = params.cluster
        const knownNamespaces = await call(namespaces)({ cluster })
        const namespacesWithPods = []

        for (const namespace of knownNamespaces) {
            const knownPods = await call(pods)({ cluster, namespace })

            namespacesWithPods.push({
                name: namespace,
                pods: knownPods,
            })
        }

        return {
            title: 'Spacegun ∞ Pods ∞ ' + cluster,
            name: params.cluster,
            namespaces: namespacesWithPods,
        }
    }

    @Resource({ path: '/images/:image/:tag?' })
    public async images(params: { image: string; tag?: string }): Promise<object> {
        const name = params.image
        const tag = params.tag || 'latest'
        const knownTags = await call(tags)({ name })
        const knownImages = knownTags.map(t => ({ name, tag: t }))

        let focusedImage
        if (knownTags.some(t => tag === t)) {
            focusedImage = await call(image)({ name, tag })
        }

        return {
            title: 'Spacegun ∞ Images ∞ ' + image,
            name,
            images: knownImages,
            focusedImage,
        }
    }
}
