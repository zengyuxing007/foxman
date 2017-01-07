import neiTools from './nei';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { util, fileUtil, DispatherTypes } from '../../helper';
import _ from 'util';
import globule from 'globule';

/**
 * Nei 插件
 */
class NeiPlugin {
	constructor(options) {
		this.options = options;
	}

	init(serverPlugin) {
		const key = this.options.key;

		const home = os.homedir();
		const basedir = path.resolve(home, 'localMock', key);

		this.server = serverPlugin.server;
		const doUpdate = this.config.argv.update || false;
		this.neiRoute = path.resolve(basedir, 'nei.route.js');

		if (doUpdate) {
			this.downloadNeiData(key, basedir);
		} else {
			this.useLocalData(basedir);
		}
	}

	useLocalData(basedir) {
		const serverConfigFiles = globule.find(path.resolve(basedir, 'nei**/server.config.js'));
		try {
			if (serverConfigFiles.length == 0) {
				throw new Error('can`t find server.config');
			}
			this.setNeiMockDir(require(serverConfigFiles[0]));
			this.routes = require(this.neiRoute);
		} catch (e) {
			util.error('nei资源不完整，请执行 $ foxman -u');
		}
		this.updateRoutes(this.routes);
	}

	downloadNeiData(key, basedir) {
		return this.pending((resolve) => {
			neiTools
				.run({
					key, basedir
				})
				.then((config) => {
					return this.getUpdate(config);
				})
				.then(() => {
					resolve();
					return this.updateRoutes(this.routes);
				});
		});
	}

	setNeiMockDir(neiConfig) {
		this.mockTpl = neiConfig.mockTpl;
		this.mockApi = neiConfig.mockApi;
	}

	getUpdate(config) {
    /**
     * neiConfigRoot
     * @type {string|*}
     */
		const neiConfigRoot = path.resolve(config.neiConfigRoot, 'server.config.js');
		const neiConfig = require(neiConfigRoot);
		const rules = neiConfig.routes;
		this.setNeiMockDir(neiConfig);
		this.routes = this.formatRoutes(rules);
		return this.updateLocalFiles(this.routes);
	}

	formatRoutes(rules) {
		let routes = [];
		let neiRoute = this.neiRoute;

		for (let ruleName in rules) {
			if (rules.hasOwnProperty(ruleName)) {
				let filePath, id;
				let rule = rules[ruleName];
				let [method, url] = ruleName.split(' ');

        // nei url 默认都是不带 / ,检查是否有
				url = util.appendHeadBreak(url);

				let sync = rule.hasOwnProperty('list');

				if (sync) {
					[filePath, id] = [rule.list[0].path, rule.list[0].id];
				} else {
					[filePath, id] = [rule.path, rule.id];
				}

				routes.push({
					method,
					url,
					sync,
					filePath,
					id
				});
			}
		}
		fileUtil.writeFile(neiRoute, `module.exports = ${_.inspect(routes, { maxArrayLength: null })}`, () => {
		}, (e) => {
			util.error(e);
		});
		return routes;
	}

	updateLocalFiles(routes = []) {
		const promises = routes.map((route) => {
			return new Promise((resolve, reject) => {
        /**
         * 本地路径（非nei）
         */
				let dataPath = this.genCommonPath(route);
				fs.stat(dataPath, error => {
          /**
           * 文件不存在或者文件内容为空
           */
					if (error) {
						util.log('make empty file: ' + dataPath);
						fileUtil.writeUnExistsFile(dataPath, '').then(resolve, reject);
						return 0;
					}
					resolve();
				});
			});
		});
		return new Promise((...args) => {
			Promise.all(promises).then(() => {
				args[0](routes);
			}).catch((e) => {
				util.error(e);
			});
		});
	}

	updateRoutes(routes) {
		const genCommonPath = this.genCommonPath.bind(this);
		const genNeiApiUrl = this.genNeiApiUrl.bind(this);
		const server = this.server;
		server.use(function* (next) {
      /**
       * @TODO
       * 判断是否使用本地文件的逻辑移动到此处
       */
			const dispatcher = this.dispatcher;

			if (dispatcher.type == DispatherTypes.DIR ||
                !dispatcher.isRouter) {
				return yield next;
			}
			const routeModel = {
				sync: DispatherTypes.SYNC == dispatcher.type,
				filePath: dispatcher.filePath,
			};
			const commonPath = genCommonPath(routeModel);

			yield new Promise((resolve) => {
				fs.stat(commonPath, (error, stat) => {
          /**
           * 文件不存在或者文件内容为空
           */
					if (error || !stat.size) {
						dispatcher.dataPath = genNeiApiUrl(routeModel);
					} else {
						dispatcher.dataPath = commonPath;
					}
					resolve();
				});
			});

			yield next;
		});
		server.routers = server.routers.concat(routes);
	}

	genCommonPath(route) {
		const server = this.server;
		let filePath = route.filePath;

		if (route.sync) {
			return server.syncDataMatch(util.jsonPathResolve(route.filePath));
		}

		if (!server.divideMethod) {
			const methodReg = /(GET)|(DELETE)|(HEAD)|(PATCH)|(POST)|(PUT)\//i;
			filePath = filePath.replace(methodReg, '');
		}

		return server.asyncDataMatch(util.jsonPathResolve(filePath.replace(/\/data/g, '')));
	}

	genNeiApiUrl(route) {
		return path.resolve(route.sync ? this.mockTpl : this.mockApi, route.filePath + '.json');
	}
}

export default NeiPlugin;
