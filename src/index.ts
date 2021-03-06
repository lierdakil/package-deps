import pMap from 'p-map'
import pFilter from 'p-filter'

import { confirmPackagesToInstall, getView } from './view'
import {
  invariant,
  isPackageIgnored,
  getDependencies,
  resolveDependencyPath,
  shouldInstallDependency,
  installPackage,
} from './helpers'
import { DependencyResolved } from './types'

type DependenciesResolved = (DependencyResolved | DependencyResolved[])[]

export async function install(packageName: string): Promise<void> {
  invariant(typeof packageName === 'string' && packageName.length > 0, '[Package-Deps] Package name is required')

  if (isPackageIgnored(packageName)) {
    // User ignored this package
    return
  }

  // Get list of relevant dependencies
  const dependencies = await getDependencies(packageName)

  if (dependencies.length === 0) {
    // Short-circuit
    return
  }

  // Resolve directories of relevant dependencies
  const resolvedDependencies: DependenciesResolved = await Promise.all(
    dependencies.map(async (item) => {
      if (Array.isArray(item)) {
        return Promise.all(
          item.map(async (subitem) => ({
            ...subitem,
            directory: await resolveDependencyPath(subitem.name),
          })),
        )
      }

      return { ...item, directory: await resolveDependencyPath(item.name) }
    }),
  )

  // Filter out already installed, in range dependencies
  // If one dependency from a group is already installed, whole group is ignored
  const dependenciesToInstall = await pFilter(resolvedDependencies, async function (item) {
    if (Array.isArray(item)) {
      return (await Promise.all(item.map((subitem) => shouldInstallDependency(subitem)))).every(Boolean)
    }
    return shouldInstallDependency(item)
  })

  if (dependenciesToInstall.length === 0) {
    // Short-circuit if all have been skipped
    return
  }

  const chosenDependencies = await confirmPackagesToInstall({
    packageName,
    dependencies: dependenciesToInstall,
  })

  if (chosenDependencies.length === 0) {
    // Short-circuit if user interaction cancelled all
    return
  }

  const view = getView({
    packageName,
    dependencies: chosenDependencies,
  })

  await pMap(
    chosenDependencies,
    async function (dependency) {
      try {
        await installPackage(dependency)
        view.handleDependencyInstalled(dependency)
      } catch (err) {
        view.handleFailure({
          dependency,
          error: err,
        })
      }
    },
    {
      concurrency: 2,
    },
  )
  view.handleComplete()
}
