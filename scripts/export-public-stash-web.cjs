const {spawnSync}=require('node:child_process');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const result=spawnSync(process.execPath,[path.join(root,'node_modules/expo/bin/cli'),'export','--platform','web','--output-dir',process.argv[2]??path.join(root,'public-web/dist')],{cwd:root,stdio:'inherit',env:{...process.env,MYSTASH_PUBLIC_WEB:'true',MYSTASH_PUBLIC_WEB_PROOF:'false',EXPO_PUBLIC_PUBLIC_STASH_PROOF:'false'}});
if(result.error)throw result.error;process.exitCode=result.status??1;
