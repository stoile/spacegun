# Spacegun
[![Build Status](https://travis-ci.org/dvallin/spacegun.svg?branch=master)](https://travis-ci.org/dvallin/spacegun)
[![codecov](https://codecov.io/gh/dvallin/spacegun/branch/master/graph/badge.svg)](https://codecov.io/gh/dvallin/spacegun)

Space age deployment manager to get your docker images to kubernetes, without the headaches of fancy ui.

## Getting Started

If you only want the cli you can install it with

```
npm install -g spacegun
```

and then run it from the console. The help message should get you started

### Installing

Just run 

```
yarn build
```

then you can run the cli with

```
node bin/spacegun
```

### Three modes of operation

Spacegun comes in three flavors
1. Server (bin/spacegun-server)
2. Client (bin/spg)
3. Standalone (bin/spacegun)

The server build is meant to be deployed in an environment that can reach all your clusters and your image repository, but can also be reached by the clients. The server build runs cronsjobs, keeps caches of the current state of all resources and runs an HTTP Api (autogenerated messy rest).

The client build is meant to be run on developers consoles as a cli interface to the server.

The standalone build is just the client and server functionality compiled directly into one executable. So you can play around with your configurations before deploying to an actual environment.

### Configuring Spacegun

#### Config.yml
Spaceguns main configuration file is just a yml containing information about your cluster and image repository. By default Spacegun will look under `./config.yml` relative to its working directory.

A configuraiton may look like this

```
docker: https://my.docker.repository.com
kube: kube/config
server:
  host: localhost
  port: 8080
```

`docker` gives a url of a docker repository  
`kube` gives a path to a kubernetes config file (relative to the config.yml)  
`server` gives hostname and port of the server (client uses both, server uses the port)

#### Jobs

Spacegun is driven by deployment jobs. A job is configured by a `<jobname>.yml`. By default spacegun scans the `./job` folder relative to its configuration file for such files.

Here is an example of a job that deploys the newest images that are not tagged as `latest` from your docker registry to your `develop` kubernetes cluster
```
cluster: k8s.develop.my.cluster.com
cron: "0 */5 * * * MON-FRI"
from: 
  type: image
  expression: "^(?!.*latest).*$"
```
`cron` is just a crontab. This one is defined to trigger the job every 5 minutes from Monday to Friday.  
`from` describes where Spacegun should get new image versions from. `type` is defined as image, so the docker registry is used.

Here is an example of a job that deploys from `develop` to your `prelive` environemt
```
cluster: k8s.prelive.my.cluster.com
cron: "0 0 0 12 * * MON-FRI"
from:
  type: cluster
  expression: k8s.develop.my.cluster.com
```
`cron` is defined to run this job at 12am every day from Monday to Friday.  
`from` is defined as cluster. In this mode, Spacegun deploys only those images that are newer on develop than on prelive.

If `cron` is not present the server will not create a cronjob and the deployment needs to be manually run by a client.

## Running the tests

run the tests with

```
yarn test
```

## Authors

* **Maximilian Schuler** - *Initial work* - [dvallin](https://github.com/dvallin)


## License

This project is licensed under the MIT License - see the [LICENSE.md](LICENSE.md) file for details

## Dependencies

* [@kubernetes/client-node](https://github.com/kubernetes-client/javascript)
* [axios](https://github.com/axios/axios)
* [chalk](https://github.com/chalk/chalk)
* [command-line-args](https://github.com/75lb/command-line-args)
* [lodash](https://github.com/lodash/lodash)
* [ora](https://github.com/sindresorhus/ora)
