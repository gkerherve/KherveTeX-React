// Fetches the SwiftLaTeX XeTeX + dvipdfmx engines (release v20022022) into
// web/swiftlatex/ and patches their TeX file lookup for the "try it online"
// build. SwiftLaTeX's own package server (texlive2.swiftlatex.com) is gone,
// so the files come from kTeX's package tree on GitHub Pages instead: a flat
// folder of TeX files plus index.txt (one name per line), served as static
// files. The stock lookup asks for <endpoint>xetex/<format>/<name> and needs
// a custom "fileid" response header, which a static host cannot send. A file
// the page already wrote into /tex (the gzipped format, swiftlatex.ts) is
// used as it is.
//
//   node scripts/swiftlatex_patch.mjs
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const URL = 'https://github.com/SwiftLaTeX/SwiftLaTeX/releases/download/v20022022/20-02-2022.zip'
const out = new globalThis.URL('../web/swiftlatex/', import.meta.url).pathname
const tmp = mkdtempSync(join(tmpdir(), 'swiftlatex-'))
execFileSync('curl', ['-sSL', '-o', join(tmp, 'r.zip'), URL])
execFileSync('unzip', ['-oq', join(tmp, 'r.zip'), '-d', join(tmp, 'x')])
mkdirSync(out, { recursive: true })

// kpathsea format number -> the suffix kpse adds when the name has none.
const LOOKUP = `let ktexIndex=null;
function ktexLookup(name,format){if(ktexIndex===null){ktexIndex=new Set;try{let x=new XMLHttpRequest;x.open("GET",self.texlive_endpoint+"index.txt",false);x.send();if(x.status===200){for(const l of x.responseText.split("\\n")){if(l)ktexIndex.add(l)}}}catch(e){console.log("kTeX package index unavailable")}}
const sfx={3:".tfm",4:".afm",6:".bib",7:".bst",10:".fmt",11:".map",20:".ofm",23:".ovf",26:".tex",32:".pfb",33:".vf",36:".ttf",44:".enc",47:".otf"}[format];
if(sfx&&!name.endsWith(sfx)&&ktexIndex.has(name+sfx))return name+sfx;if(ktexIndex.has(name))return name;return null}
function kpse_find_file_impl(nameptr,format,_mustexist){let reqname=UTF8ToString(nameptr);if(reqname.startsWith("/tex/")){reqname=reqname.substr(5)}if(reqname.includes("/")){return 0}const cacheKey=format+"/"+reqname;if(cacheKey in texlive404_cache){return 0}if(cacheKey in texlive200_cache){const savepath=texlive200_cache[cacheKey];return allocate(intArrayFromString(savepath),"i8",ALLOC_NORMAL)}
const real=ktexLookup(reqname,format);if(real===null){texlive404_cache[cacheKey]=1;return 0}
const local=TEXCACHEROOT+"/"+real;try{FS.stat(local);texlive200_cache[cacheKey]=local;return allocate(intArrayFromString(local),"i8",ALLOC_NORMAL)}catch(e){}
const remote_url=self.texlive_endpoint+encodeURIComponent(real);let xhr=new XMLHttpRequest;xhr.open("GET",remote_url,false);xhr.responseType="arraybuffer";try{xhr.send()}catch(err){console.log("TexLive Download Failed "+remote_url);return 0}
if(xhr.status===200){const savepath=TEXCACHEROOT+"/"+real;FS.writeFile(savepath,new Uint8Array(xhr.response));texlive200_cache[cacheKey]=savepath;return allocate(intArrayFromString(savepath),"i8",ALLOC_NORMAL)}
texlive404_cache[cacheKey]=1;return 0}`

for (const f of ['swiftlatexxetex', 'swiftlatexdvipdfm']) {
  const src = readFileSync(join(tmp, 'x', `${f}.js`), 'utf8')
  const re = /function kpse_find_file_impl\(nameptr,format,_mustexist\)\{[\s\S]*?\}var moduleOverrides=/
  if (!re.test(src)) throw new Error(`${f}.js: kpse_find_file_impl not found`)
  writeFileSync(join(out, `${f}.js`), src.replace(re, () => LOOKUP + 'var moduleOverrides='))
  copyFileSync(join(tmp, 'x', `${f}.wasm`), join(out, `${f}.wasm`))
}
console.log('SwiftLaTeX engines written to', out)
