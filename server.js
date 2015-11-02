var express = require('express'),
	multer  = require('multer'),
	fs = require('fs'),
	crypto = require('crypto'),
	stream = require('stream'),
	util = require('util'),
	mime = require('mime-types'),
	zlib = require('zlib'),
	path = require('path'),
	RBTree = require('bintrees').RBTree;
var upload_dir = "uploads/";
var temp_dir = "temp/";
var gzip_dir = "gzip/"
var storage_limit = 75*1024*1024*1024; //75GB
var app = express()
var sha = {};
var gzip = {};
app.use(multer({ 
	dest: temp_dir,
	onFileUploadStart: function(file, req, res) {
		res.connection.setTimeout(60*1000);
		sha[file.path] = crypto.createHash('sha512');
		sha[file.path].setEncoding('hex');
		gzip[file.path] = zlib.createGzip();
		var wstream = fs.createWriteStream(gzip_dir+file.name);
		gzip[file.path].pipe(wstream).on('finish', function() {
			fs.unlink(file.path)
			delete gzip[file.path]
		})
	},
	onFileUploadData: function (file, data, req, res) {
		res.connection.setTimeout(60*1000);
		sha[file.path].write(data);
		gzip[file.path].write(data);
	},
	onFileUploadComplete: function (file, req, res) {
		sha[file.path].end();
		gzip[file.path].end();
		var hash = sha[file.path].read().toString();
		sha[file.path] = hash;
		var filepath = upload_dir+hash;

		if (!fs.existsSync(filepath)) { 
			fs.rename(gzip_dir+file.name, filepath, function() {
				addFile(hash);
			});
		}
		else {
			delete gzip[file.path];
			fs.unlink(gzip_dir+file.name);
			touchFile(hash);
		}
	}
}));

app.get('/', function(req, res){
	res.send('<form action="" method="post" enctype="multipart/form-data">'+
		'<input type="file" name="upload-file" multiple>'+
		'<input type="submit" value="Upload">'+
		'</form>');
});

var file_tree, file_total_size = 0;
function initialize() {
	file_tree = new RBTree(function(a, b){
		if (a.time != b.time) return a.time - b.time; // time inc
		if (a.size != b.size) return b.size - a.size; // size dec
		if (a.hash == b.hash) return 0;
		if (a.hash < b.hash) return -1;
		return 1; 
	});
	fs.readdir(upload_dir, function(err, files){
		for (var i in files) {
			addFile(files[i]); 
		}

	console.log("Total Number of Files: "+file_tree.size);
	console.log("Total File Size: "+file_total_size);
	});
}
initialize();

function getFileStat(hash) {
	var filestat = fs.statSync(upload_dir+hash);
	return {'hash': hash, 'time': filestat.mtime.getTime(), 'size': filestat.size};
}
var checking_size = false;
function addFile(hash) {
	var file = getFileStat(hash);
	file_total_size += file.size;
	file_tree.insert(file);
	console.log("Added "+hash);
	if (checking_size) return;
	checking_size = true;
	/* Check Size */
	while (file_total_size > storage_limit) {
		console.log(file_tree.min());
		deleteFile(file_tree.min().hash);
	}
	checking_size = false;
}
function deleteFile(hash) {
	var file = getFileStat(hash);
	file_total_size -= file.size;
	file_tree.remove(file);
	fs.unlink(upload_dir+hash);
}
function touchFile(hash) {
	console.log("Touch "+hash);
	file_tree.remove(getFileStat(hash));
	fs.utimes(upload_dir+hash, new Date(), new Date());
	file_tree.insert(getFileStat(hash));
}

app.get('/:hash', function(req, res) {
	var ext = path.extname(req.params.hash);
	var hash = path.basename(req.params.hash, ext);
	var filepath = upload_dir+hash;
	var accepted_encoding = (""+req.get('Accept-Encoding')).split(', ');
	fs.exists(filepath, function(exists) {
		if(!exists) {
			res.writeHead(404, "Not Found");
			res.end();
			return;
		}
		touchFile(hash)
		var fileStream = fs.createReadStream(filepath);
		if (accepted_encoding.indexOf('gzip') == -1) {
			var gunzip = zlib.createGunzip();
			res.writeHead(200, {'Content-Type': mime.lookup(req.params.hash)});
			fileStream
			.pipe(gunzip)
			.pipe(res);
		}
		else {
			res.writeHead(200, {'Content-Type': mime.lookup(req.params.hash), 'Content-Encoding': 'gzip'});
			fileStream.pipe(res);
		}
	});
	
});



app.post('/', function(req, res){
	var output = {}, done_count = 0, total_count = 0;
	for (var field in req.files) {
		if (req.files[field].constructor === Array) {
			for (var i in req.files[field]) {
				output[field+"_"+i] = sha[req.files[field][i].path];
				if (req.files[field][i].extension) output[field+"_"+i] += "." + req.files[field][i].extension;
				delete sha[req.files[field][i].path];
			}
		}
		else {
			output[field] = sha[req.files[field].path];
			if (req.files[field].extension) output[field] += "." + req.files[field].extension;
			delete sha[req.files[field].path];
		}
	}
	res.json(output).status(204).end();
});


app.listen(80);
