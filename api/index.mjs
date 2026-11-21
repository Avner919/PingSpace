import {createApi} from '../server/api.mjs';
import {createPostgresStore} from '../server/postgres-store.mjs';
let ready;
export default async function handler(req,res){
 try{ready??=createPostgresStore().then(store=>createApi({store}));const api=await ready;await api.handle(req,res);}
 catch(e){ready=undefined;console.error('API initialization failed:',e.code||'database unavailable');res.writeHead(503,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify({error:'База данных временно недоступна. Попробуйте ещё раз.'}));}
}
