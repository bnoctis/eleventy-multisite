import { join, relative } from 'path'
import { sync as globSync } from 'glob'
import minimatch from 'minimatch'
import ignore from 'ignore'
import { existsSync, readFileSync } from 'fs'
const Eleventy = require('@11ty/eleventy')
const ConsoleLogger = require('@11ty/eleventy/src/Util/ConsoleLogger')

export interface SiteConfig {
	outDir?: string,
	configPath?: string,
	pathPrefix?: string,
	templateFormats?: string[],
	ignoreGlobal?: boolean,
}

export type SiteSpec = string | [string, SiteConfig]

export interface Config {
	baseDir: string,
	outDir: string,
	sites: SiteSpec[],
	pathPrefix?: string,
	templateFormats?: string[],

	excludes?: string[] | string,
	includesDir?: string,
	layoutsDir?: string,
}

export interface UserConfig {
	baseDir?: string,
	outDir?: string,
	sites?: SiteSpec[],
	pathPrefix?: string,
	templateFormats?: string[],

	excludes?: string[] | string,
	includesDir?: string,
	layoutsDir?: string,
}

export const DEFAULT_CONFIG: Config = {
	baseDir: 'sites/',
	outDir: '_out/',
	sites: ['*'],
	includesDir: '_includes/',
	layoutsDir: '_layouts/'
}

export interface RunOptions {
	sourceDir: string,
	outDir: string,
	configPath: string,
	pathPrefix?: string,
	templateFormats?: string[],
	port?: number,
	serve?: boolean,
	watch?: boolean,
	dryRun?: boolean,
	incremental?: boolean,
	quite?: boolean,

	ignoreGlobal?: boolean,
	globalConfigPath?: string,
}

// An Eleventy/Util/ConsoleLogger, proxied to add `[multisite] ` before each message.
export const logger = new Proxy(new ConsoleLogger, {
	get: function(target: typeof ConsoleLogger, prop: string) {
		if(['log', 'forceLog', 'warn', 'error'].includes(prop)) {
			return function(msg: string) {
				target[prop](`[multisite] ${msg}`)
			}
		} else {
			return target[prop]
		}
	}
})

/** Find sites in `baseDir` with given `patterns`.
  *
  * @param {Config} config - Global config.
  * @param {string[] | string} patterns - Glob patterns for the sites.
  * @returns {string[]} Site bases relative to `baseDir`.
  */
export function findSites(config: Config, patterns: string[] | string): string[] {
	const ignoreFilter = existsSync('.gitignore') ? (() => {
		const ig = ignore().add(readFileSync('.gitignore').toString())
		return ig.filter.bind(ig)
	})() : (x: string) => x
	if(typeof patterns === 'string') {
		patterns = [patterns]
	}
	let results = []
	for(let pattern of patterns) {
		if(!pattern.endsWith('/')) {
			pattern += '/'
		}
		pattern = join(config.baseDir, pattern)
		// For the following line tsc throws this error:
		//
		// ```
		// error TS2345: Argument of type 'string[]' is not assignable to parameter of type 'readonly string[] & string'.
		//   Type 'string[]' is not assignable to type 'string'.
		// ```
		// which is weird, because parameter `ignore` has the type `string | ReadonlyArray<string> | undefined`,
		// which is definitely not `readonly string[] & string`, which looks impossible to get.
		// TODO: get rid of this error
		// @ts-ignore
		for(let base of ignoreFilter(globSync(pattern, { ignore: config.excludes }))) {
			// Filter out matches under `config.outDir`, `config.includesDir` or `config.layoutsDir`
			if(!relative(config.outDir, base).startsWith('..') ||
			config.includesDir && !relative(config.includesDir, base).startsWith('..') ||
			config.layoutsDir && !relative(config.layoutsDir, base).startsWith('..')) {
				continue
			}
			results.push(relative(config.baseDir, base))
		}
	}
	return results
}

/** Run eleventy on a given site.
  *
  * Based on `@11ty/eleventy/cmd.js`, made some changes to suit our need.
  *
  * @param {RunOptions} options
  */
export function runEleventy(options: RunOptions) {
	const eleventy = new Eleventy(options.sourceDir, options.outDir, {
		quietMode: options.quite,
		configPath: options.ignoreGlobal ? options.configPath : options.globalConfigPath,
	})
	eleventy.setPathPrefix(options.pathPrefix)
	eleventy.setDryRun(options.dryRun)
	eleventy.setIncrementalBuild(options.incremental)
	eleventy.setFormats(options.templateFormats)
	if(!options.ignoreGlobal && options.configPath !== undefined) {
		require(options.configPath)(eleventy.eleventyConfig)
	}
	eleventy
		.init()
		.then(() => {
			let watched = true
			try {
				if(options.serve || options.watch) {
					eleventy.watch()
						.catch(() => watched = false)
						.then(() => {
							if(options.serve && watched) {
								eleventy.serve(options.port)
							} else {
								logger.forceLog(`Started watching site ${options.sourceDir}`)
							}
						})
				} else {
					// TODO: support JSON / ndjson builds
					eleventy.write()
				}
			} catch(e) {
				// TODO: handle error
			}
		})
}

/** Match a `SiteConfig` for a given site, going through glob patterns.
  *
  * @param {Config} config
  * @param {string} site
  * @returns {SiteConfig | undefined}
  *
  */
export function matchSiteConfig(config: Config, site: string): SiteConfig | undefined {
	for(let siteSpec of config.sites) {
		const glob = typeof siteSpec === 'string' ? siteSpec : siteSpec[0]
		if(minimatch(site, glob)) {
			if(typeof siteSpec === 'string') {
				// string sitespec uses default config
				return
			} else {
				return siteSpec[1]
			}
		}
	}
}

