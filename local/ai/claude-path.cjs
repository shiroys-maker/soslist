'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
function resolveClaude(env=process.env){
 const candidates=env.SOSLIST_CLAUDE_BIN?[env.SOSLIST_CLAUDE_BIN]:[path.join(os.homedir(),'.local/bin/claude'),'/opt/homebrew/bin/claude','/usr/local/bin/claude',...(env.PATH||'').split(path.delimiter).filter(Boolean).map(dir=>path.join(dir,'claude'))];
 for(const candidate of candidates)try{if(path.isAbsolute(candidate)){fs.accessSync(candidate,fs.constants.X_OK);return candidate;}}catch(_){}
 throw Error('Claude Code CLIが見つかりません。');
}
module.exports={resolveClaude};
