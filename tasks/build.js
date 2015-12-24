/*
 * grant-max-build
 * https://github.com/max/build
 *
 * Copyright (c) 2015 TFC
 * Licensed under the MIT license.
 */

'use strict';

//var esprima = require('esprima'),
var	estraverse = require('estraverse'),
	doctrine = require('doctrine'),
	path = require('path');
var S = require('string');
var ejs = require('ejs');
var minify = require("uglify-js").minify;
var beautify = require('js-beautify').js_beautify;
var espree = require("espree");
var _ = require('lodash');

var padlen=60;
var allservices = "all.services";
var allfiles = "all.files";
var report_file_name="all_services";
var db_adapters = ['mysql','postgresql','mongodb'];

String.prototype.replaceBetween = function(start, end, what) {
    return this.substring(0, start) + what + this.substring(end);
};

module.exports = function(grunt) {
	var services = {};
	var files =[];
	var names = [];
	var sourceFold, resourcesFold, testFold, entityFold, targetFold, serviceFold, targetModFold,targetTestFold,outFold;
	var indev = true;

	function init(options,env) {
        indev = (env === "development" ? true : false);
		sourceFold = options.main || "./src/main";
		resourcesFold = options.resources || "./src/resources";
		entityFold = options.entity || "./src/entity";
        testFold = options.test || "./src/test";
        
		targetFold = options.build || "./target";
		serviceFold = path.join(targetFold, "services");
		targetModFold = path.join(serviceFold, "modules");
		outFold = path.join(targetFold, "out");
        targetTestFold =path.join(targetFold, "test");
        
		if (!grunt.file.exists(targetFold) || !grunt.file.isDir(targetFold)) {
			grunt.file.mkdir(targetFold);
		}

		if (!grunt.file.exists(serviceFold) || !grunt.file.isDir(serviceFold)) {
			grunt.file.mkdir(serviceFold);
		}
		if (!grunt.file.exists(outFold) || !grunt.file.isDir(outFold)) {
			grunt.file.mkdir(outFold);
		}
		if (!grunt.file.exists(targetTestFold) || !grunt.file.isDir(targetTestFold)) {
			grunt.file.mkdir(targetTestFold);
		}

	}


	function analyze_module(filename,node,cb) {
		var comment, data, params, seq_params, missing;
		var serv= {};
        
		
		if(node.leadingComments.length ===0){
			cb("comment not fund");
		}
		
		comment = node.leadingComments[node.leadingComments.length-1];
		
		if (comment.type !== 'Block') {
			cb("comment type is not Block");
		}
 
		data = doctrine.parse(comment.value, {unwrap: true	});
        
        serv.description = data.description;
		serv.name = node.id.name;
		params = {};
		data.tags.forEach(function(tag) {
			switch (tag.title) {
				case "param":
					params[tag.name] = {
						desc: tag.description,
						type: tag.type.name
					};
					break;
				case "service":
					serv.service = 1;
					serv.call_name = tag.description ? tag.description.toLowerCase() : node.id.name.toLowerCase();
					break;
				case "deprecated":
					serv.deprecated = tag.description  ? tag.description : "接口不再使用";
					break;
				default:

			}
		});

		serv.params = params;
		
		missing = [];
		seq_params = [];
		var params_names = Object.keys(params);
		node.params.forEach(function(param) {
			seq_params.push(param.name);
			if (params_names.indexOf(param.name) < 0) {
				missing.push(param.name);
			}
		});

		if (seq_params.length !== params_names.length) {
			cb(filename +':In function: ' + node.id.name + '(Line ' + node.loc.start.line + ' ):  参数个数不相等');
		}

		if (missing.length > 0) {
			var msg = filename + ': In function' + node.id.name + '(Line' + node.loc.start.line + '):';
			missing.forEach(function(m) {
				msg +=' Parameter' + m + '没有文档注释.';
			});
			cb(msg);
		}


		serv.seq_params = seq_params;
		if (serv.service === 1 && names.indexOf(serv.call_name) !== -1) {
			cb(filename + ':In function[' + node.id.name + '](Line' + node.loc.start.line + "): publish the same service name '" + serv.call_name + "'");		
		}
		names.push(data.call_name);
		var mod = path.basename(filename, '.js');
		if(!services[mod])
			services[mod] = [];
		services[mod].push(serv)
		cb(null,"success");
	}
    
    function checkModReq(content,comment){
		var data = doctrine.parse(comment.value, {unwrap: true	}); 
		var is_module_desc=false;
		var requires=[];
		data.tags.forEach(function(tag) {
			switch (tag.title) {
				case "module":
					is_module_desc=true;
					break;
				case "requires":
					var mod = getRequiredMod(tag.name.split('#'));
					if(mod){
						requires.push(mod);
					}
					break;
				default:
					break;
			}
		});
		
		if(is_module_desc && requires){
			content = content.replaceBetween(comment.range[0],comment.range[1], requires.join('\n'));
		}
		return content;
	}
	
	function getRequiredMod(tag){
		var req="";
		if(!tag){
			return req;
		}
		switch (tag[0]) {
			case "Log":
				//req = "var Log=require('log')();";
				break;
			case "Err":
				req = "var Err=require('exception');";
				break;
			case "Config":
				req = "var Config = require('nodejs-config')();";
				break;
			case "db":
			    var dbAdapter="mysql";
			    if(tag[1] && _.findIndex(db_adapters,tag[1])!== -1){
					dbAdapter = tag[1];
				}
				req = "var db = require('node-db')('" + dbAdapter + "').connect();";
				break;
			default:
				break;
		}
		return req;
	}
	
	function check(filename, targetdir) {
		grunt.log.ok("Service from: " + filename);
		try {
			var content = S(grunt.file.read(filename)).trimRight().s;
			//var tree = esprima.parse(content, { attachComment: true,loc: true});
			var tree = espree.parse(content,{ range: true, loc: true, comments: true,attachComment: true,});		
		    content = checkModReq(content, tree.comments[0]);
			estraverse.traverse(tree, {
				enter: function (node, parent) {
					//if (node.type == 'FunctionExpression' || node.type == 'FunctionDeclaration')
					//	return estraverse.VisitorOption.Skip;
					switch (node.type) {
						case espree.Syntax.FunctionDeclaration:
							analyze_module(filename,node,function(error,data){	if (error) {grunt.fail.fatal(error);} });				
							break;
						case espree.Syntax.VariableDeclaration:
							//console.log(node);
							break;
						case espree.Syntax.BlockStatement:
							//console.log(node);
							break;
						default:
							break;
					}//switch
				},
				leave: function (node, parent) {
					//if (node.type == 'VariableDeclarator')
					//	console.log(node.id.name);
				}
			});

			var basename = path.basename(filename, '.js');

			var fun_template = grunt.file.read(path.join(__dirname, "../ejs/function.ejs"));
			var data = ejs.render(fun_template, {
				"services": services[basename],
				"content" : content
			});
			
			var result = indev ? beautify(data, {
				indent_size: 4, max_preserve_newlines: 1
			}) : minify(data, {
				fromString: true
			}).code;
			grunt.file.write(path.join(targetdir, basename + ".js"), result);
		} catch (e) {
			grunt.log.error("error: ", e.toString(), e.stack);
			return false;
		}
	}

	function buildAllServices() {
		grunt.log.writeln(S("build all service file").padRight(padlen, '.').s);
		grunt.file.recurse(sourceFold, function(abspath, rootdir, subdir, filename) {
			var targetdir = path.join(targetModFold, (typeof subdir !== "undefined" ? subdir : ""));
			if (!grunt.file.exists(targetdir) || !grunt.file.isDir(targetdir)) {
				grunt.file.mkdir(targetdir);
			}
			if (S(filename).startsWith("service_") && path.extname(filename) === ".js") {
				files.push(S(abspath).chompLeft('src/main').s);
				check(abspath, targetdir);
			} else if (path.extname(filename) === ".js") {
				var result = indev ? beautify(grunt.file.read(abspath)) : minify(abspath).code;
				grunt.file.write(path.join(targetdir, filename), result);
			} else {
				grunt.file.copy(abspath, path.join(targetdir, filename));
			}

		});

		var myString = new Buffer(JSON.stringify(services));
		var myBuffer = JSON.stringify(myString);

		grunt.file.write(path.join(serviceFold, allservices), myBuffer.substring(25, myBuffer.length - 2));
		//grunt.file.write(path.join(serviceFold, allservices), myString);
		grunt.file.write(path.join(serviceFold, allfiles), JSON.stringify(files));
		saveToHtml(report_file_name);
		services={};
		names=[];
	}

    function buildTest() {
		grunt.log.writeln(S("Build Test Files").padRight(padlen, '.').s);
		grunt.file.recurse(testFold, function(abspath, rootdir, subdir, filename) {
			var targetdir = path.join(targetTestFold, (typeof subdir !== "undefined" ? subdir : ""));
			if (!grunt.file.exists(targetdir) || !grunt.file.isDir(targetdir)) {
				grunt.file.mkdir(targetdir);
			}
			
			grunt.file.copy(abspath, path.join(targetdir, filename));
		});
	}
	
	
	function buildResources() {
		grunt.log.writeln(S("build resources file").padRight(padlen, '.').s);
		grunt.file.recurse(resourcesFold, function(abspath, rootdir, subdir, filename) {
			var targetdir = path.join(serviceFold, (typeof subdir !== "undefined" ? subdir : ""));
			if (!grunt.file.exists(targetdir) || !grunt.file.isDir(targetdir)) {
				grunt.file.mkdir(targetdir);
			}
			grunt.file.copy(abspath, path.join(targetdir, filename));
		});
	}

	function buildEntities() {
		grunt.log.writeln(S("build entities file").padRight(padlen, '.').s);
		var content = ""; var tables=[];
		grunt.file.recurse(entityFold, function(abspath, rootdir, subdir, filename) {
			if (path.extname(filename) === ".js") {
				content += grunt.file.read(abspath);
			}
		});
		var tree = espree.parse(content,{ range: true, loc: true, comments: true,attachComment: true,});
		estraverse.traverse(tree, {
			enter: function (node, parent) { 
					switch (node.type) {
						case espree.Syntax.VariableDeclaration:
							tables.push(node.declarations[0].id.name);
							break;
						default:
							break;
					}//switch
			},
			leave: function (node, parent) {}
		});
		
		var fun_template = grunt.file.read(path.join(__dirname, "../ejs/tables.ejs"));
		var data = ejs.render(fun_template, {
			"vars": tables,
			"declarations": content
		});
		var result = indev ? beautify(data) : minify(data, {
			fromString: true
		}).code;
		grunt.file.write(path.join(serviceFold, "tables.js"), result);
	}

	function buildService(filename) {
		filename = "service_" + filename + ".js";
		grunt.log.writeln("start build  service file - " + filename);
		check(path.join(sourceFold, filename));
		saveToHtml(path.basename(filename));
	}

	function saveToHtml(outname) {
		var content = ejs.render(grunt.file.read(path.join(__dirname, "../ejs/serivces.ejs")), {
			"services": services
		});
		grunt.file.write(path.join(outFold, outname + ".html"), content);
		grunt.log.ok("REPORT IS SUCCESSFULLY SAVED TO ", outname + ".html");
	}

	function buildAll() {		
		buildAllServices();
	    buildResources();
		buildEntities();
		buildTest();
	}

	grunt.registerTask('build', 'build  service file for dev', function() {
		init(this.options(),process.env.NODE_ENV || 'development');
		buildAll();
	});
    grunt.registerTask('buildService', 'build  service file for dev', function(file) {
		init(this.options(),'dev');
		buildService(filename);
	});
	
	grunt.registerTask('buildServices', 'build  service file for dev', function() {
		init(this.options(),'dev');
		buildAllServices();
	});
	
	grunt.registerTask('buildResources', 'build  service file for dev', function() {
		init(this.options(),'dev');
		buildResources();
	});
	
	grunt.registerTask('buildEntities', 'build  service file for dev', function() {
		init(this.options(),'dev');
		buildEntities();
	});
	
	grunt.registerTask('buildTest', 'build  service file for dev', function() {
		init(this.options(),'dev');
		buildTest();
	});
};
