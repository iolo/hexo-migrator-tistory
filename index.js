var xml2js = require('xml2js'),
  async = require('async'),
  tomd = require('to-markdown').toMarkdown,
  request = require('request'),
  moment = require('moment'),
  fs = require('fs'),
  util = hexo.util,
  file = util.file2;

hexo.extend.migrator.register('tistory', function(args, callback){
  var source = args._.shift();

  if (!source){
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
    function(next){
      // URL regular expression from: http://blog.mattheworiordan.com/post/13174566389/url-regular-expression-for-links-with-or-without-the
      if (source.match(/((([A-Za-z]{3,9}:(?:\/\/)?)(?:[-;:&=\+\$,\w]+@)?[A-Za-z0-9.-]+|(?:www.|[-;:&=\+\$,\w]+@)[A-Za-z0-9.-]+)((?:\/[\+~%\/.\w-_]*)?\??(?:[-\+=&;%@.\w_]*)#?(?:[.\!\/\\w]*))?)/)){
        request(source, function(err, res, body){
          if (err) throw err;
          if (res.statusCode == 200) next(null, body);
        });
      } else {
        file.readFile(source, next);
      }
    },
    function(content, next){
      xml2js.parseString(content, next);
    },
    function(xml, next){
      var count = 0;

      async.each(xml.blog.post, function(item, next){
        var
          slug = item.$.slogan,
          title = item.title && item.title[0],
          // tistory use unix timestamp(in sec)
          date = moment.unix(item.published || item.modified || item.created),
          categories = String(item.category && item.category[0]).split('/'),
          tags = item.tag,
          // TODO: replace tistory inline attachment into markdown
          content = tomd(item.content[0]);

        count += 1;

        var data = {
          title: title || slug,
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
          t_id: item.id && item.id[0]
        };

        // migrate post.visibility to layout
        if (item.visibility && item.visibility[0] != 'public') {
          data.layout = 'draft';
        }

        // TODO: migrate page...
        // data.layout = 'page';

        // XXX: migrate attachments...
        if (item.attachment) {
          data.attachments = item.attachment.map(function (att) {
            // $: {size: .., width: ..., height: ...},
            // label: [...],
            // name: [...],
            // content: [...]
            var attpath = '/attachments/' + date.format('YYYY-MM-DD') + '-' + item.id + '-' + att.label[0];
            fs.writeFileSync('source' + attpath, new Buffer(att.content[0], 'base64'));
            return '![' + att.label[0] + '](' + attpath + ')';
          });
        }

        log.i('Post found: %s', data.title);
        //console.log(data);next();
        post.create(data, next);
      }, function(err){
        if (err) return next(err);

        log.i('%d posts migrated.', count);
      });
    }
  ], callback);
});
