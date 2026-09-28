const express=require("express"),cors=require("cors"),path=require("path"),Database=require("better-sqlite3"),bcrypt=require("bcryptjs"),jwt=require("jsonwebtoken");
const app=express(),PORT=process.env.PORT||3000,SECRET=process.env.JWT_SECRET||"CHANGE_THIS_SECRET";
const DB_DIR=process.env.DB_DIR || path.join(__dirname,'data');
const fs=require('fs'); fs.mkdirSync(DB_DIR,{recursive:true});
const db=new Database(path.join(DB_DIR,'golan_stora.db'));

app.use(cors());app.use(express.json());app.use(express.static(path.join(__dirname,".")));
db.exec(`CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'customer',created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,category TEXT NOT NULL,price REAL NOT NULL,active INTEGER DEFAULT 1,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS digital_codes(id INTEGER PRIMARY KEY AUTOINCREMENT,product_id INTEGER NOT NULL,code TEXT UNIQUE NOT NULL,status TEXT DEFAULT 'available',order_id INTEGER,delivered_at TEXT);
CREATE TABLE IF NOT EXISTS wallets(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER UNIQUE NOT NULL,balance REAL DEFAULT 0,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS deposits(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,amount REAL NOT NULL,payment_method TEXT NOT NULL,payment_reference TEXT NOT NULL,status TEXT DEFAULT 'pending',created_at TEXT DEFAULT CURRENT_TIMESTAMP,confirmed_at TEXT);
CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY AUTOINCREMENT,order_code TEXT UNIQUE NOT NULL,user_id INTEGER,product_id INTEGER NOT NULL,customer_contact TEXT NOT NULL,payment_method TEXT NOT NULL,payment_reference TEXT NOT NULL,status TEXT DEFAULT 'pending_payment',created_at TEXT DEFAULT CURRENT_TIMESTAMP);`);
if(process.env.ADMIN_EMAIL&&process.env.ADMIN_PASSWORD&&!db.prepare("SELECT id FROM users WHERE email=?").get(process.env.ADMIN_EMAIL)){db.prepare("INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,'admin')").run("Golan Stora Admin",process.env.ADMIN_EMAIL,bcrypt.hashSync(process.env.ADMIN_PASSWORD,10))}
if(db.prepare("SELECT COUNT(*) c FROM products").get().c===0){let s=db.prepare("INSERT INTO products(name,category,price,active) VALUES(?,?,?,1)");[["PUBG Mobile UC","games",1.5],["Free Fire Diamonds","games",1.25],["PlayStation Gift Card","cards",10],["Netflix Subscription","subscriptions",5],["Mobile Recharge","mobile",2],["Windows / Office License","software",8]].forEach(x=>s.run(...x))}
function auth(req,res,next){let h=req.headers.authorization||"";if(!h.startsWith("Bearer "))return res.status(401).json({error:"Unauthorized"});try{req.user=jwt.verify(h.slice(7),SECRET);next()}catch(e){res.status(401).json({error:"Invalid token"})}}
function admin(req,res,next){auth(req,res,()=>req.user.role==="admin"?next():res.status(403).json({error:"Admin only"}))}
app.get("/api/products",(q,r)=>r.json({products:db.prepare("SELECT * FROM products ORDER BY id DESC").all()}));
app.post("/api/register",(q,r)=>{let{name,email,password}=q.body||{};if(!name||!email||!password)return r.status(400).json({error:"Missing fields"});try{let x=db.prepare("INSERT INTO users(name,email,password_hash) VALUES(?,?,?)").run(name,email,bcrypt.hashSync(password,10));db.prepare("INSERT OR IGNORE INTO wallets(user_id,balance) VALUES(?,0)").run(x.lastInsertRowid);r.json({ok:true,id:x.lastInsertRowid})}catch(e){r.status(400).json({error:"Email already exists"})}});
app.post("/api/login",(q,r)=>{let{email,password}=q.body||{},u=db.prepare("SELECT * FROM users WHERE email=?").get(email);if(!u||!bcrypt.compareSync(password,u.password_hash))return r.status(401).json({error:"Invalid login"});r.json({token:jwt.sign({id:u.id,email:u.email,role:u.role},SECRET,{expiresIn:"7d"}),user:{id:u.id,name:u.name,email:u.email,role:u.role}})});

app.get("/api/wallet",auth,(q,r)=>{
 const w=db.prepare("SELECT balance FROM wallets WHERE user_id=?").get(q.user.id)||{balance:0};
 r.json({balance:Number(w.balance)});
});
app.post("/api/deposits",auth,(q,r)=>{
 const {amount,payment_method,payment_reference}=q.body||{};
 if(!amount||Number(amount)<=0||!payment_method||!payment_reference) return r.status(400).json({error:"أدخل المبلغ وطريقة الدفع ورقم العملية"});
 const x=db.prepare("INSERT INTO deposits(user_id,amount,payment_method,payment_reference,status) VALUES(?,?,?,?, 'pending')").run(q.user.id,Number(amount),payment_method,payment_reference);
 r.json({ok:true,id:x.lastInsertRowid,status:"pending"});
});
app.get("/api/my-deposits",auth,(q,r)=>r.json({deposits:db.prepare("SELECT * FROM deposits WHERE user_id=? ORDER BY id DESC").all(q.user.id)}));
app.get("/api/my-orders",auth,(q,r)=>r.json({orders:db.prepare(`SELECT o.order_code,o.status,o.created_at,p.name product_name,p.price,dc.code delivered_code FROM orders o JOIN products p ON p.id=o.product_id LEFT JOIN digital_codes dc ON dc.order_id=o.id WHERE o.user_id=? ORDER BY o.id DESC`).all(q.user.id)}));
app.post("/api/buy",auth,(q,r)=>{
 const {product_id}=q.body||{}, p=db.prepare("SELECT * FROM products WHERE id=? AND active=1").get(product_id);
 if(!p) return r.status(404).json({error:"Product not found"});
 const tx=db.transaction(()=>{
   const w=db.prepare("SELECT balance FROM wallets WHERE user_id=?").get(q.user.id)||{balance:0};
   if(Number(w.balance)<Number(p.price)) throw new Error("الرصيد غير كافٍ");
   const code=db.prepare("SELECT * FROM digital_codes WHERE product_id=? AND status='available' ORDER BY id LIMIT 1").get(p.id);
   if(!code) throw new Error("المنتج غير متوفر حالياً");
   db.prepare("UPDATE wallets SET balance=balance-?,updated_at=CURRENT_TIMESTAMP WHERE user_id=?").run(Number(p.price),q.user.id);
   const orderCode="GS-"+Date.now().toString(36).toUpperCase()+"-"+Math.floor(100+Math.random()*900);
   const o=db.prepare("INSERT INTO orders(order_code,user_id,product_id,customer_contact,payment_method,payment_reference,status) VALUES(?,?,?,?,?,?, 'completed')").run(orderCode,q.user.id,p.id,"account-wallet","wallet","wallet-purchase");
   db.prepare("UPDATE digital_codes SET status='sold',order_id=?,delivered_at=CURRENT_TIMESTAMP WHERE id=?").run(o.lastInsertRowid,code.id);
   return {order_code:orderCode,code:code.code,balance:Number(w.balance)-Number(p.price)};
 });
 try{r.json({ok:true,...tx()})}catch(e){r.status(400).json({error:e.message})}
});
app.get("/api/admin/deposits",admin,(q,r)=>r.json({deposits:db.prepare(`SELECT d.*,u.email,u.name FROM deposits d JOIN users u ON u.id=d.user_id ORDER BY d.id DESC`).all()}));
app.patch("/api/admin/deposits/:id",admin,(q,r)=>{
 if(q.body.status!=="confirmed"&&q.body.status!=="rejected") return r.status(400).json({error:"Invalid status"});
 const dep=db.prepare("SELECT * FROM deposits WHERE id=?").get(q.params.id);
 if(!dep) return r.status(404).json({error:"Deposit not found"});
 if(dep.status!=="pending") return r.status(400).json({error:"Deposit already processed"});
 const tx=db.transaction(()=>{
   db.prepare("UPDATE deposits SET status=?,confirmed_at=CURRENT_TIMESTAMP WHERE id=?").run(q.body.status,q.params.id);
   if(q.body.status==="confirmed"){
     db.prepare("INSERT OR IGNORE INTO wallets(user_id,balance) VALUES(?,0)").run(dep.user_id);
     db.prepare("UPDATE wallets SET balance=balance+?,updated_at=CURRENT_TIMESTAMP WHERE user_id=?").run(dep.amount,dep.user_id);
   }
 });
 tx();r.json({ok:true});
});

app.post("/api/orders",(q,r)=>{let{product_id,customer_contact,payment_method,payment_reference}=q.body||{},p=db.prepare("SELECT * FROM products WHERE id=? AND active=1").get(product_id);if(!p)return r.status(404).json({error:"Product not found"});if(!customer_contact||!payment_reference)return r.status(400).json({error:"Missing fields"});let code="GS-"+Date.now().toString(36).toUpperCase()+"-"+Math.floor(100+Math.random()*900);let x=db.prepare("INSERT INTO orders(order_code,product_id,customer_contact,payment_method,payment_reference,status) VALUES(?,?,?,?,?,'pending_payment')").run(code,p.id,customer_contact,payment_method,payment_reference);r.json({ok:true,order:{id:x.lastInsertRowid,order_code:code,status:"pending_payment"}})});
app.get("/api/admin/stats",admin,(q,r)=>r.json({products:db.prepare("SELECT COUNT(*) c FROM products WHERE active=1").get().c,orders:db.prepare("SELECT COUNT(*) c FROM orders").get().c,pending:db.prepare("SELECT COUNT(*) c FROM orders WHERE status='pending_payment'").get().c,paid:db.prepare("SELECT COUNT(*) c FROM orders WHERE status='paid'").get().c,completed:db.prepare("SELECT COUNT(*) c FROM orders WHERE status='completed'").get().c}));
app.get("/api/admin/orders",admin,(q,r)=>r.json({orders:db.prepare("SELECT o.*,p.name product_name,p.price FROM orders o JOIN products p ON p.id=o.product_id ORDER BY o.id DESC").all()}));
app.patch("/api/admin/orders/:id/status",admin,(q,r)=>{
 const ok=["pending_payment","paid","processing","completed","cancelled"];
 if(!ok.includes(q.body.status)) return r.status(400).json({error:"Invalid status"});
 const order=db.prepare("SELECT * FROM orders WHERE id=?").get(q.params.id);
 if(!order) return r.status(404).json({error:"Order not found"});
 if(q.body.status==="paid" && order.status!=="paid"){
   const deliver=db.transaction(()=>{
     const code=db.prepare("SELECT * FROM digital_codes WHERE product_id=? AND status='available' ORDER BY id LIMIT 1").get(order.product_id);
     if(!code) throw new Error("لا يوجد كود متاح لهذا المنتج");
     db.prepare("UPDATE digital_codes SET status='sold',order_id=?,delivered_at=CURRENT_TIMESTAMP WHERE id=?").run(order.id,code.id);
     db.prepare("UPDATE orders SET status='paid' WHERE id=?").run(order.id);
     return code;
   });
   try {
     const code=deliver();
     return r.json({ok:true,delivered_code:code.code});
   } catch(e) { return r.status(400).json({error:e.message}); }
 }
 db.prepare("UPDATE orders SET status=? WHERE id=?").run(q.body.status,q.params.id);
 r.json({ok:true});
});

app.get("/api/admin/codes",admin,(q,r)=>{
 const rows=db.prepare(`SELECT dc.id,dc.code,dc.status,dc.order_id,dc.delivered_at,p.name product_name
   FROM digital_codes dc JOIN products p ON p.id=dc.product_id ORDER BY dc.id DESC`).all();
 r.json({codes:rows});
});
app.post("/api/admin/codes",admin,(q,r)=>{
 const {product_id,codes}=q.body||{};
 if(!product_id||!Array.isArray(codes)||!codes.length) return r.status(400).json({error:"اختر المنتج وأدخل الأكواد"});
 let added=0, skipped=0;
 const ins=db.prepare("INSERT INTO digital_codes(product_id,code,status) VALUES(?,?,'available')");
 const tx=db.transaction(()=>{for(const raw of codes){const c=String(raw).trim();if(!c)continue;try{ins.run(product_id,c);added++}catch(e){skipped++}}});
 tx(); r.json({ok:true,added,skipped});
});
app.get("/api/order/:code", (q,r)=>{
 const o=db.prepare(`SELECT o.order_code,o.status,o.customer_contact,o.product_id,p.name product_name,
   dc.code delivered_code FROM orders o JOIN products p ON p.id=o.product_id
   LEFT JOIN digital_codes dc ON dc.order_id=o.id WHERE o.order_code=?`).get(q.params.code);
 if(!o) return r.status(404).json({error:"Order not found"});
 r.json({order:o});
});

app.post("/api/admin/products",admin,(q,r)=>{let{name,category,price}=q.body||{};if(!name||!category||pricķe===undefined)return r.status(400).json({error:"Missing fields"});let x=db.prepare("INSERT INTO products(name,category,price,active) VALUES(?,?,?,1)").run(name,category,Number(price));r.json({ok:true,id:x.lastInsertRowid})});
app.get("*",(q,r)=>r.sendFile(path.join(__dirname,","index.html")));
app.listen(PORT,()=>console.log("Golan Stora running on http://localhost:"+PORT));
