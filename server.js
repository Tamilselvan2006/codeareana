const express=require('express'),session=require('express-session'),bcrypt=require('bcryptjs'),Database=require('better-sqlite3'),{spawnSync}=require('child_process'),fs=require('fs'),os=require('os'),path=require('path');
const db=new Database('data.db');
db.exec(`create table if not exists users(id integer primary key,email text unique,name text,hash text,role text default 'student',closed int default 0,reason text);
create table if not exists questions(id integer primary key,type text,title text,body text,options text,answer text,points int default 10,tests text,active int default 1);
create table if not exists subs(id integer primary key,uid int,qid int,answer text,score int,flag text default '',at integer,unique(uid,qid));
create table if not exists kv(k text primary key,v text);
create table if not exists logs(id integer primary key,uid int,msg text,at integer);`);
const kv=(k,v)=>v===undefined?(db.prepare('select v from kv where k=?').get(k)||{}).v:db.prepare('insert or replace into kv values(?,?)').run(k,String(v));
// Admin seed (change using env ADMIN_USER / ADMIN_PASS)
const AU=process.env.ADMIN_USER||'Tamilselvan D',AP=process.env.ADMIN_PASS||'presidentcsai';
if(!db.prepare("select 1 from users where role='admin'").get())db.prepare('insert into users(email,name,hash,role) values(?,?,?,?)').run(AU.toLowerCase(),AU,bcrypt.hashSync(AP,10),'admin');
const app=express();app.use(express.json({limit:'200kb'}));
app.use(session({secret:process.env.SECRET||'change-this-secret',resave:false,saveUninitialized:false,cookie:{httpOnly:true,sameSite:'lax'}}));
const auth=role=>(q,s,n)=>{const u=q.session.uid&&db.prepare('select * from users where id=?').get(q.session.uid);if(!u||(role&&u.role!==role))return s.status(401).json({e:'Login pannunga'});q.u=u;n()};
const live=(q,s,n)=>{if(q.u.closed)return s.status(403).json({e:'Un attempt close aagiduchu'});const e=+kv('end')||0;if(!e||Date.now()>e)return s.status(403).json({e:'Contest nadakkala / mudinjiduchu'});n()};
// ---- auth
app.post('/api/register',(q,s)=>{const{email,name,password}=q.body;if(!/^\S+@\S+\.\S+$/.test(email||'')||!name||(password||'').length<6)return s.status(400).json({e:'Valid email, name, password(6+) venum'});
 try{db.prepare('insert into users(email,name,hash) values(?,?,?)').run(email.trim().toLowerCase(),name.trim(),bcrypt.hashSync(password,10))}catch(e){return s.status(409).json({e:'Intha mail already register aagiduchu'})}s.json({ok:1})});
app.post('/api/login',(q,s)=>{const u=db.prepare('select * from users where email=?').get(String(q.body.login||'').trim().toLowerCase());
 if(!u||!bcrypt.compareSync(q.body.password||'',u.hash))return s.status(401).json({e:'Wrong login / password'});q.session.uid=u.id;s.json({ok:1})});
app.post('/api/logout',(q,s)=>q.session.destroy(()=>s.json({ok:1})));
app.get('/api/state',auth(),(q,s)=>{const qs=db.prepare('select * from questions where active=1 order by type,id').all().map(x=>{const t=JSON.parse(x.tests||'[]');return{id:x.id,type:x.type,title:x.title,body:x.body,options:x.options?JSON.parse(x.options):null,points:x.points,sample:t[0]||null}});
 s.json({u:{name:q.u.name,role:q.u.role,closed:q.u.closed,reason:q.u.reason},end:+kv('end')||0,now:Date.now(),rules:kv('rules')||'',qs,subs:db.prepare('select qid,score from subs where uid=?').all(q.u.id)})});
// ---- code runner (NOTE: use Docker/Judge0 for real sandboxing in production)
function run(code,lang,input){const js=lang==='js',f=path.join(os.tmpdir(),'c'+Date.now()+Math.random().toString(36).slice(2)+(js?'.js':'.py'));fs.writeFileSync(f,code);
 const r=spawnSync(js?'node':'python3',[f],{input:input+'\n',timeout:3000,encoding:'utf8',maxBuffer:1e6});fs.unlinkSync(f);return{out:(r.stdout||'').trim(),err:r.error?'Timeout / Error':(r.stderr||'').slice(0,300)}}
const runAll=(c,l,t)=>{let pass=0;const res=t.map(x=>{const r=run(c,l,x.input);const ok=r.out===String(x.output).trim();if(ok)pass++;return{ok,...r}});return{pass,res}};
const norm=c=>c.replace(/#.*$|\/\/.*$/gm,'').replace(/\s+/g,'').toLowerCase();
app.post('/api/run',auth('student'),live,(q,s)=>{const x=db.prepare("select * from questions where id=? and type='code'").get(q.body.qid);if(!x)return s.status(404).json({e:'No question'});
 const t=JSON.parse(x.tests||'[]').slice(0,1);s.json(runAll(String(q.body.code||''),q.body.lang,t))});
app.post('/api/submit',auth('student'),live,(q,s)=>{const{qid,answer,lang}=q.body;const x=db.prepare('select * from questions where id=? and active=1').get(qid);if(!x)return s.status(404).json({e:'No question'});
 if(db.prepare('select 1 from subs where uid=? and qid=?').get(q.u.id,qid))return s.status(409).json({e:'Already submitted - once mattum'});
 let score=0,flag='',info='';
 if(x.type==='apt')score=String(answer).trim()===x.answer.trim()?x.points:0;
 else{const t=JSON.parse(x.tests||'[]'),r=runAll(String(answer||''),lang,t);score=Math.round(x.points*r.pass/(t.length||1));info=r.pass+'/'+t.length+' test cases passed';
  const n=norm(String(answer));for(const o of db.prepare('select id,uid,answer from subs where qid=?').all(qid))if(norm(o.answer)===n){flag='Same code as user#'+o.uid;db.prepare("update subs set flag=? where id=?").run('Same code as user#'+q.u.id,o.id)}}
 db.prepare('insert into subs(uid,qid,answer,score,flag,at) values(?,?,?,?,?,?)').run(q.u.id,qid,String(answer),score,flag,Date.now());s.json({score,info})});
app.post('/api/violation',auth('student'),(q,s)=>{if(!q.u.closed&&Date.now()<(+kv('end')||0)){const r=String(q.body.r||'Tab switch').slice(0,80);db.prepare('update users set closed=1,reason=? where id=?').run(r,q.u.id);db.prepare('insert into logs(uid,msg,at) values(?,?,?)').run(q.u.id,r,Date.now())}s.json({ok:1})});
app.get('/api/leaderboard',auth(),(q,s)=>s.json(db.prepare("select u.name,coalesce(sum(s.score),0) score,max(s.at) last,u.closed from users u left join subs s on s.uid=u.id where u.role='student' group by u.id order by score desc,last asc").all()));
// ---- admin
const A=auth('admin');
app.post('/api/admin/question',A,(q,s)=>{const b=q.body;try{if(b.tests)JSON.parse(b.tests);if(b.type==='apt'&&(!b.options||!b.answer))throw 0}catch(e){return s.status(400).json({e:'Options/answer/tests JSON check pannunga'})}
 db.prepare('insert into questions(type,title,body,options,answer,points,tests) values(?,?,?,?,?,?,?)').run(b.type,b.title,b.body,b.type==='apt'?JSON.stringify(b.options.split(',').map(x=>x.trim())):null,b.answer||'',+b.points||10,b.tests||'[]');s.json({ok:1})});
app.delete('/api/admin/question/:id',A,(q,s)=>{db.prepare('update questions set active=0 where id=?').run(q.params.id);s.json({ok:1})});
app.post('/api/admin/settings',A,(q,s)=>{if(q.body.days)kv('end',Date.now()+q.body.days*864e5);if(q.body.rules!==undefined)kv('rules',q.body.rules);s.json({ok:1})});
app.post('/api/admin/reopen/:id',A,(q,s)=>{db.prepare('update users set closed=0,reason=null where id=?').run(q.params.id);s.json({ok:1})});
app.get('/api/admin/report',A,(q,s)=>s.json({
 users:db.prepare("select id,name,email,closed,reason from users where role='student'").all(),
 flags:db.prepare("select u.name,u.email,s.qid,s.score,s.flag from subs s join users u on u.id=s.uid where s.flag!=''").all(),
 logs:db.prepare('select u.name,l.msg,l.at from logs l join users u on u.id=l.uid order by l.at desc').all(),
 qs:db.prepare('select id,type,title,points from questions where active=1').all(),rules:kv('rules')||'',end:+kv('end')||0}));
app.use(express.static(path.join(__dirname,'public')));
app.listen(process.env.PORT||3000,()=>console.log('Running on http://localhost:3000'));
