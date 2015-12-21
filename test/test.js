/**
 * New node file
 */
var fs = require('fs');
var uglify = require("uglify-js");

var uglified = uglify.minify(['file1.js', 'file2.js', 'file3.js']);

fs.writeFile('concat.min.js', uglified.code, function (err){
  if(err) {
    console.log(err);
  } else {
    console.log("Script generated and saved:", 'concat.min.js');
  }      
});