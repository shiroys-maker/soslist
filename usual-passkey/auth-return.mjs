// Fixed nonsecret navigation intents only. No SDK, token, identity or I/O on import.
export const NATIVE_RETURN_PENDING_KEY='soslist.bridge.return.v1';
const AUTH='https://auth.soslist.niraissc.jp',MAIN='https://soslist.niraissc.jp';
const fail=code=>{throw Error(code);};
function exactIntent(location,origin,query){
 try{const u=new URL(location?.href);return u.origin===origin&&u.pathname==='/'&&u.search===query&&!u.hash&&!u.href.includes('#')&&!u.username&&!u.password;}
 catch{return false;}
}
function strip(history){try{history.replaceState(null,'','/');}catch{fail('RETURN_HISTORY_DENIED');}}
function stored(storage){
 if(!storage||['getItem','setItem','removeItem'].some(key=>typeof storage[key]!=='function'))fail('RETURN_STORAGE_DENIED');
 try{const value=storage.getItem(NATIVE_RETURN_PENDING_KEY);if(value!==null&&value!=='pending')fail('RETURN_STORAGE_DENIED');return value;}
 catch{fail('RETURN_STORAGE_DENIED');}
}
export function consumeUsualReturnIntent(location,history){
 if(!exactIntent(location,AUTH,'?returnTo=usual-web'))return false;
 strip(history);return true;
}
export function createUsualReturnController({intent,location}={}){
 let returned=false;
 return Object.freeze({observe(state){
  if(intent!==true||returned||state?.phase!=='authenticated')return;
  if(typeof location?.replace!=='function')fail('RETURN_LOCATION_DENIED');
  returned=true;location.replace(MAIN+'/?auth=passkey-return');
 }});
}
export function consumeNativeReturnIntent(location,history,storage){
 if(!exactIntent(location,MAIN,'?auth=passkey-return'))return false;
 // Strip before any storage/SDK operation, including when persistence is blocked.
 strip(history);
 if(storage!==undefined){
  try{if(stored(storage)===null)storage.setItem(NATIVE_RETURN_PENDING_KEY,'pending');if(stored(storage)!=='pending')fail('RETURN_STORAGE_DENIED');}
  catch{fail('RETURN_STORAGE_DENIED');}
 }
 return true;
}
/** Call after SDK initialization, synchronously BEFORE starting completeLogin.
 * A marker/forged URL conveys no identity and cannot authorize an exchange. */
export function takeNativeReturnIntent(storage){
 if(stored(storage)===null)return false;
 try{storage.removeItem(NATIVE_RETURN_PENDING_KEY);if(stored(storage)!==null)fail('RETURN_STORAGE_DENIED');}
 catch{fail('RETURN_STORAGE_DENIED');}
 return true;
}
