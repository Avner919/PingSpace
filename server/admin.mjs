import { createInterface } from 'node:readline/promises';
import { emitKeypressEvents } from 'node:readline';
import { createRuntimeStore } from './runtime-store.mjs';
async function password(prompt) {
  if (!process.stdin.isTTY) throw Error('Запустите npm run admin в обычном терминале.');
  process.stdout.write(prompt);
  emitKeypressEvents(process.stdin);process.stdin.setRawMode(true);process.stdin.resume();
  return new Promise((resolve,reject)=>{
    let value='';
    const finish=(error)=>{process.stdin.removeListener('keypress',onKey);process.stdin.setRawMode(false);process.stdin.pause();process.stdout.write('\n');error?reject(error):resolve(value);};
    const onKey=(text,key)=>{
      if (key?.ctrl&&key.name==='c') return finish(Error('Отменено.'));
      if (key?.name==='return') return finish();
      if (key?.name==='backspace') {if(value.length){value=value.slice(0,-1);process.stdout.write('\b \b');}return;}
      if(text&&!key?.ctrl&&!key?.meta&&!/[\x00-\x1f\x7f]/.test(text)){value+=text;process.stdout.write('*'.repeat(text.length));}
    };
    process.stdin.on('keypress',onKey);
  });
}
let store;
try {
  const rl=createInterface({input:process.stdin,output:process.stdout});
  const email=await rl.question('E-mail администратора: ');rl.close();
  const first=await password('Новый пароль (не менее 10 символов): ');
  const second=await password('Повторите пароль: ');
  if(first!==second)throw Error('Пароли не совпадают.');
  store=await createRuntimeStore();
  const user=await store.setAdministrator(email,first);
  console.log(`Администратор ${user.email} сохранён. Войдите с этим e-mail и паролем.`);
} catch(error){console.error(error.message);process.exitCode=1;}
finally{await store?.close();}
