var
    path = require('path'),
    util = require('hexo-util'),
    fs = require('hexo-fs'),
    async = require('async'),
    request = require('request'),
    xml2js = require('xml2js'),
    moment = require('moment'),
    toMarkdown = require('to-markdown');

function slugize(str) {
    return util.slugize(str, {tranform: 1});
}

// XXX: hex has no api to get assetDir.
// see https://github.com/hexojs/hexo/blob/master/lib/hexo/post.js#L155
function getAssetDir(filePath) {
    return filePath.substring(0, filePath.length - path.extname(filePath).length);
}

function escapeFilePath(filePath) {
    var ext = path.extname(filePath);
    return slugize(path.basename(filePath, ext) + ext);
}

hexo.extend.migrator.register('tistory', function (args, callback) {
    var source = args._.shift();

    if (!source) {
        var help = [
            'Usage: hexo migrate tistory <source>',
            '',
            'For more help, you can check the docs: http://hexo.io/docs/migration.html'
        ];

        console.log(help.join('\n'));
        return callback();
    }

    var log = hexo.log,
        post = hexo.post;

    log.i('Analyzing %s...', source);

    async.waterfall([
        function (next) {
            // URL regular expression from: http://blog.mattheworiordan.com/post/13174566389/url-regular-expression-for-links-with-or-without-the
            if (source.match(/((([A-Za-z]{3,9}:(?:\/\/)?)(?:[-;:&=\+\$,\w]+@)?[A-Za-z0-9.-]+|(?:www.|[-;:&=\+\$,\w]+@)[A-Za-z0-9.-]+)((?:\/[\+~%\/.\w-_]*)?\??(?:[-\+=&;%@.\w_]*)#?(?:[.\!\/\\w]*))?)/)) {
                request(source, function (err, res, body) {
                    if (err) throw err;
                    if (res.statusCode == 200) next(null, body);
                });
            } else {
                fs.readFile(source, next);
            }
        },
        function (content, next) {
            xml2js.parseString(content, next);
        },
        function (xml, next) {
            var setting = xml.blog.setting[0];
            var tistoryUrl = 'http://' + (setting.secondaryDomain ? setting.secondaryDomain[0] : (setting.name[0] + '.tistory.com'));
            var count = 0;

            async.each(xml.blog.post, function (item, next) {
                var slug = slugize(item.$.slogan);
                // XXX: avoid to use double quotes
                var title = String(item.title && item.title[0]).replace(/"/g, '\'');
                // tistory use unix timestamp(in sec)
                var date = moment.unix(item.published || item.modified || item.created);
                var categories = String(item.category && item.category[0]).split('/').map(slugize);
                var tags = item.tag && item.tag.map(slugize);
                var content = toMarkdown(item.content[0], {gfm: true});

                // migrate tistory inline attachment into 'asset_img'
                if (item.attachment) {
                    item.attachment.forEach(function (att) {
                        // $: {mime: ..., size: .., width: ..., height: ...}, label: [...], name: [...], content: [...]
                        if (att.$ && /^image\//.test(att.$.mime)) {
                            // TODO: more robust parser... for image grid, media player, ...
                            // [##_1C|cfile7.uf.2339543D543167771A3FF2.png|width="728" height="660" alt="HEXO+: Your Autonomous Aerial Camera - Drone" filename="home-hero-product-image.png" filemime="image/png"|HEXO+: Your Autonomous Aerial Camera - Drone_##]
                            var tistoryImg = new RegExp('\\[##_([^|]+)\\|' + util.escapeRegExp(att.name[0]) + '\\|width="(\\d+)"\\s+height="(\\d+)"\\s+([^|]*)\\|([^_]*)_##]');
                            var assetImg = '{% asset_img ' + escapeFilePath(att.label[0]) + ' $2 $3 "$5" %}';
                            content = content.replace(tistoryImg, assetImg);
                        }
                    });
                }

                count += 1;

                var data = {
                    title: title,
                    slug: slug,
                    date: moment(date).format(),
                    categories: categories,
                    tags: tags,
                    content: content,
                    // tistory specific info
                    //t_author: item.author && { id: item.author[0]._, domain: item.author[0].$.domain },
                    //t_visibility: item.visibility && item.visibility[0],
                    //t_acceptComment: item.acceptComment && item.acceptComment[0],
                    //t_acceptTrackback: item.acceptTrackback && item.acceptTrackback[0],
                    //t_published: item.published && moment.unix(item.published[0]).format(),
                    //t_created: item.created && moment.unix(item.created[0]).format(),
                    //t_modified: item.modified && moment.unix(item.modified[0]).format(),
                    //t_password: item.password && item.password[0],
                    //t_location: item.location && item.location[0],
                    //t_isKorea: item.isKorea && item.isKorea[0],
                    //t_device: device,
                    //t_uselessMargin: uselessMargin,
                    tistorylink: tistoryUrl + '/' + item.id[0]
                };

                // migrate post.visibility to layout
                if (item.visibility && item.visibility[0] != 'public') {
                    data.layout = 'draft';
                }

                // TODO: migrate page...
                // data.layout = 'page';

                log.i('migrate tistory post %d --> %s', item.id, slug);
                post.create(data, true, function (err, result) {
                    if (err) {
                        log.e('failed to migrate tistory post %d', item.id);
                        return next(err);
                    }
                    // migrate tistory attachment into asset folder
                    if (item.attachment) {
                        var assetDir = getAssetDir(result.path);
                        item.attachment.forEach(function (att) {
                            var assetFile = path.join(assetDir, escapeFilePath(att.label[0]));
                            log.i('migrate tistory attachment: %s --> %s', att.label[0], assetFile);
                            fs.writeFileSync(assetFile, new Buffer(att.content[0], 'base64'));
                        });
                    }
                    return next();
                });
            }, function (err) {
                if (err) return next(err);
                log.i('%d posts migrated.', count);
            });
        }
    ], callback);
});
