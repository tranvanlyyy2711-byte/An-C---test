// Keep the owner HTML self-contained: no missing script can leave it spinning forever.
import {readFileSync,writeFileSync} from 'node:fs';
const seed=JSON.parse(readFileSync('server/tin-dang.seed.json','utf8')).map(({ownerId,...r})=>({...r,status:'approved',visible:true}));
const photoNames=[...new Set(seed.flatMap(r=>r.images.map(path=>path.split('/').pop())))];
const photos=Object.fromEntries(photoNames.map(name=>{
 const bytes=readFileSync('assets/rooms/'+name);
 const mime=bytes.toString('ascii',0,4)==='RIFF'?'image/webp':name.toLowerCase().endsWith('.png')?'image/png':'image/jpeg';
 return [name,'data:'+mime+';base64,'+bytes.toString('base64')];
}));
writeFileSync('assets/anh-phong.js','/* Generated from the original room photos; shared by owner and map. */\nwindow.AnCuRoomImages = '+JSON.stringify(photos)+';\n');
writeFileSync('assets/tin-dang-preview.js','/* Generated from server/tin-dang.seed.json. */\nwindow.ANCU_LISTING_PREVIEW = '+JSON.stringify(seed,null,2)+';\n');
let html=readFileSync('quan-ly/tin-dang.html','utf8');
const safe=s=>s.replace(/<\/script/gi,'<\\/script');
html=html.replace(/<style>[\s\S]*?<\/style>/,'<style>'+readFileSync('quan-ly/tin-dang.css','utf8')+'</style>');
html=html.replace(/<!-- LISTING_BUNDLE_START -->[\s\S]*?<!-- LISTING_BUNDLE_END -->/,'');
html=html.replace(/<script\b[^>]*src=["'][^"']*(?:tin-dang(?:-preview|-store)?\.js)[^"']*["'][^>]*><\/script>/g,'');
html=html.replace(/<link rel="stylesheet" href="tin-dang.css[^\"]*">/g,'');
const js=['assets/tin-dang-preview.js','assets/anh-phong.js','assets/tin-dang-store.js','quan-ly/tin-dang.js'].map(p=>safe(readFileSync(p,'utf8'))).join('\n');
html=html.replace('</body>',`<!-- LISTING_BUNDLE_START --><script>\nwindow.addEventListener('error',function(e){if(e.target===window){var box=document.getElementById('bootError');box.hidden=false;box.textContent='Trang gặp lỗi: '+e.message+'. Hãy gửi thông báo này cho người sửa web.';}});\n${js}\n</script><!-- LISTING_BUNDLE_END --></body>`);
writeFileSync('quan-ly/tin-dang.html',html);
console.log('Built self-contained quan-ly/tin-dang.html');
