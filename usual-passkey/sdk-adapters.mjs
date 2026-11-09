// Injected SDK bindings only. No SDK imports, initialization, ADC, environment,
// credentials, listeners, network transport or signing runs at import/factory time.
const PROJECTS=new Set(['sos-list-4d150','demo-soslist-bridge']);
const HEX=/^[a-f0-9]{64}$/;
const READ=/^(?:(?:members|credentials|sessions)\/[a-f0-9]{64}|subjects\/(?:bridge_|session_end_)[a-f0-9]{64})$/;
const CREATE=/^subjects\/(?:bridge_|session_end_)[a-f0-9]{64}$/;
const UPDATE=/^(?:(?:members|credentials|sessions)\/[a-f0-9]{64}|subjects\/bridge_[a-f0-9]{64})$/;
const SIGNER='sos-bridge-signer@sos-list-4d150.iam.gserviceaccount.com';
const AUDIENCE='https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit';
const fail=code=>{throw Object.assign(Error(code),{code});};
const plain=x=>x!==null&&typeof x==='object'&&[Object.prototype,null].includes(Object.getPrototypeOf(x));
function fields(x,keys){
 if(!plain(x)||Reflect.ownKeys(x).length!==keys.length)fail('SDK_INPUT_DENIED');
 const out=Object.create(null);for(const key of keys){const d=Object.getOwnPropertyDescriptor(x,key);if(!d?.enumerable||!Object.hasOwn(d,'value'))fail('SDK_INPUT_DENIED');out[key]=d.value;}return out;
}
function data(x){if(!plain(x))fail('SDK_INPUT_DENIED');for(const key of Reflect.ownKeys(x)){const d=Object.getOwnPropertyDescriptor(x,key);if(typeof key!=='string'||['__proto__','prototype','constructor'].includes(key)||!d.enumerable||!Object.hasOwn(d,'value'))fail('SDK_INPUT_DENIED');}return x;}
function scope(db,projectId,databaseId,expected){if(!PROJECTS.has(projectId)||databaseId!==expected||db?.projectId!==projectId||db.databaseId!==databaseId||typeof db.doc!=='function')fail('SDK_SCOPE_DENIED');}
function snapshotData(snapshot){if(snapshot?.exists===false)return null;if(snapshot?.exists!==true||typeof snapshot.data!=='function')fail('SDK_SNAPSHOT_DENIED');return data(snapshot.data());}
function accessInputs({db,projectId,databaseId}={}){scope(db,projectId,databaseId,'soslist-access');return{db,projectId,databaseId};}
function accessRef(c,path,pattern=READ){scope(c.db,c.projectId,c.databaseId,'soslist-access');if(typeof path!=='string'||!pattern.test(path))fail('SDK_PATH_DENIED');return c.db.doc(path);}
export function createAccessReader(input){const c=accessInputs(input);return Object.freeze({async get(path){return snapshotData(await accessRef(c,path).get());}});}
export function createAccessStore(input){
 const c=accessInputs(input);if(typeof c.db.runTransaction!=='function')fail('SDK_SCOPE_DENIED');
 return Object.freeze({
  async get(path){return snapshotData(await accessRef(c,path).get());},
  async transaction(callback){
   if(typeof callback!=='function')fail('SDK_INPUT_DENIED');scope(c.db,c.projectId,c.databaseId,'soslist-access');
   return c.db.runTransaction(async sdkTx=>{
    let active=true,written=false;const alive=()=>{if(!active)fail('SDK_TRANSACTION_CLOSED');};
    const tx=Object.freeze({
     async get(path){alive();if(written)fail('SDK_TRANSACTION_READ_ORDER');return snapshotData(await sdkTx.get(accessRef(c,path)));},
     create(path,value){alive();const ref=accessRef(c,path,CREATE);data(value);sdkTx.create(ref,value);written=true;},
     update(path,value){alive();const ref=accessRef(c,path,UPDATE);data(value);sdkTx.update(ref,value);written=true;},
    });
    try{return await callback(tx);}finally{active=false;}
   });
  },
 });
}
function time(version){if(!version||typeof version!=='object'||!Number.isSafeInteger(version.seconds)||version.seconds< -62135596800||version.seconds>253402300799||!Number.isInteger(version.nanoseconds)||version.nanoseconds<0||version.nanoseconds>999999999)fail('SDK_MIRROR_VERSION_DENIED');return[version.seconds,version.nanoseconds];}
export function createMirrorStore({db,projectId,databaseId,subjects}={}){
 scope(db,projectId,databaseId,'(default)');
 if(!Array.isArray(subjects)||subjects.length<1||subjects.length>5||subjects.some(s=>typeof s!=='string'||!HEX.test(s))||new Set(subjects).size!==subjects.length)fail('SDK_SCOPE_DENIED');
 const allowed=new Set(subjects),observed=new WeakMap();
 const ref=subject=>{scope(db,projectId,databaseId,'(default)');if(!allowed.has(subject))fail('SDK_PATH_DENIED');return db.doc('__sos_bridge_accounts/'+subject);};
 return Object.freeze({
  async snapshot(subject){
   const snapshot=await ref(subject).get(),value=snapshotData(snapshot);if(value===null)return null;
   const version=snapshot.updateTime,tuple=time(version);let versions=observed.get(version);if(!versions){versions=new Map();observed.set(version,versions);}versions.set(subject,tuple);
   return{data:value,version};
  },
  async cas(subject,version,next){
   if(!allowed.has(subject))fail('SDK_PATH_DENIED');const prior=version&&typeof version==='object'?observed.get(version)?.get(subject):undefined,current=time(version);
   if(!prior||prior[0]!==current[0]||prior[1]!==current[1])fail('SDK_MIRROR_VERSION_DENIED');data(next);
   try{await ref(subject).update(next,{lastUpdateTime:version});return true;}
   catch(error){if([9,10,'9','10','FAILED_PRECONDITION','ABORTED','failed-precondition','aborted'].includes(error?.code))return false;throw error;}
  },
 });
}
/** Already-created compat-style named Auth only. Raw modular SDKs need an
 * explicit same-instance wrapper mapping SESSION persistence before using this.
 */
export async function prepareNamedFirebaseAuth(auth){
 if(auth?.app?.name!=='soslist-passkey'||!['setPersistence','onAuthStateChanged','signInWithCustomToken','signOut'].every(key=>typeof auth[key]==='function')||!('currentUser'in auth))fail('SDK_AUTH_PREPARE_DENIED');
 let unsubscribe,invalid=false;
 try{
  await auth.setPersistence('session');
  const initial=await new Promise((resolve,reject)=>{
   let settled=false;
   const good=user=>{if(settled)return;settled=true;resolve(user);},bad=()=>{if(settled)return;settled=true;reject(Error('SDK_AUTH_PREPARE_DENIED'));};
   try{unsubscribe=auth.onAuthStateChanged(good,bad);if(typeof unsubscribe!=='function'){invalid=true;bad();}}catch{bad();}
  });
  if(invalid||initial===undefined||auth.currentUser!==initial)fail('SDK_AUTH_PREPARE_DENIED');
 }catch{fail('SDK_AUTH_PREPARE_DENIED');}
 finally{if(typeof unsubscribe==='function')try{unsubscribe();}catch{fail('SDK_AUTH_PREPARE_DENIED');}}
 return Object.freeze({appName:'soslist-passkey',persistence:'session',initialAuthReady:true,
  get currentUser(){return auth.currentUser;},
  signInWithCustomToken:token=>{if(typeof token!=='string'||!token||token.length>16384)fail('SDK_INPUT_DENIED');return auth.signInWithCustomToken(token);},
  signOut:()=>auth.signOut(),
 });
}
export function createCustomTokenSigner({signBlob,now=Date.now}={}){
 if(typeof signBlob!=='function'||typeof now!=='function')fail('SDK_SIGNER_DENIED');
 return Object.freeze({async sign(input){
  const {uid,claims:raw}=fields(input,['uid','claims']);
  const c=fields(raw,['bridgeSubject','bridgeSession','bridgeGeneration','bridgeRole']);
  if(typeof uid!=='string'||uid.length<1||uid.length>128||/[\u0000-\u001f\u007f]/.test(uid)||typeof c.bridgeSubject!=='string'||!HEX.test(c.bridgeSubject)||typeof c.bridgeSession!=='string'||!/^session-[a-z0-9-]{1,96}$/.test(c.bridgeSession)||!Number.isSafeInteger(c.bridgeGeneration)||c.bridgeGeneration<1||!['admin','staff'].includes(c.bridgeRole))fail('SDK_SIGNER_DENIED');
  const claims={bridgeSubject:c.bridgeSubject,bridgeSession:c.bridgeSession,bridgeGeneration:c.bridgeGeneration,bridgeRole:c.bridgeRole};
  if(Buffer.byteLength(JSON.stringify(claims))>1000)fail('SDK_SIGNER_DENIED');
  const millis=now(),iat=Math.floor(millis/1000);if(!Number.isFinite(millis)||!Number.isSafeInteger(iat)||iat<0||!Number.isSafeInteger(iat+60))fail('SDK_SIGNER_DENIED');
  const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
  const signingInput=encode({alg:'RS256',typ:'JWT'})+'.'+encode({iss:SIGNER,sub:SIGNER,aud:AUDIENCE,iat,exp:iat+60,uid,claims});
  const response=await signBlob({name:'projects/-/serviceAccounts/'+SIGNER,payload:Buffer.from(signingInput).toString('base64')});
  if(!plain(response)||Reflect.ownKeys(response).some(key=>!['keyId','signedBlob'].includes(key)))fail('SDK_SIGNER_DENIED');
  const d=Object.getOwnPropertyDescriptor(response,'signedBlob'),keyId=Object.getOwnPropertyDescriptor(response,'keyId');
  if(!d||!Object.hasOwn(d,'value')||typeof d.value!=='string'||d.value.length<4||d.value.length>8192||d.value.length%4!==0||!/^[A-Za-z0-9+/]+={0,2}$/.test(d.value)||keyId&&(!Object.hasOwn(keyId,'value')||typeof keyId.value!=='string'||keyId.value.length<1||keyId.value.length>256))fail('SDK_SIGNER_DENIED');
  const signature=Buffer.from(d.value,'base64');if(signature.length<1||signature.toString('base64')!==d.value)fail('SDK_SIGNER_DENIED');
  return signingInput+'.'+signature.toString('base64url');
 }});
}
