const express=require("express");
const crypto=require("crypto");
const bcrypt=require("bcryptjs");
const {Pool}=require("pg");
const app=express();
const port=process.env.PORT||3000;
const pool=process.env.DATABASE_URL?new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.NODE_ENV==="production"?{rejectUnauthorized:false}:false}):null;
const ADMIN_USERNAME=process.env.ADMIN_USERNAME||"admin";
const ADMIN_PASSWORD=process.env.ADMIN_PASSWORD||"";
const sessions=new Map();
app.use(express.json());
app.use(express.urlencoded({extended:true}));
app.use(express.static("public"));

async function ensureDb(){
  if(!pool)return;
  await pool.query(`CREATE TABLE IF NOT EXISTS bookings(
    id SERIAL PRIMARY KEY, service TEXT NOT NULL, customer_name TEXT NOT NULL, phone TEXT NOT NULL,
    email TEXT, address TEXT, scheduled_at TEXT, notes TEXT, status TEXT NOT NULL DEFAULT 'New',
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS admin_users(
    id SERIAL PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'staff', created_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  if(ADMIN_PASSWORD){
    const existing=await pool.query("SELECT id FROM admin_users WHERE username=$1",[ADMIN_USERNAME]);
    if(!existing.rowCount){
      const hash=await bcrypt.hash(ADMIN_PASSWORD,12);
      await pool.query("INSERT INTO admin_users(username,password_hash,role) VALUES($1,$2,'owner')",[ADMIN_USERNAME,hash]);
    }
  }
}
function createSession(user){
  const token=crypto.randomBytes(32).toString("hex");
  sessions.set(token,{userId:user.id,username:user.username,role:user.role,expires:Date.now()+8*60*60*1000});
  return token;
}
function currentAdmin(req){
  const token=(req.headers.authorization||"").replace(/^Bearer\s+/i,"");
  const s=sessions.get(token);
  if(!s||s.expires<Date.now()){if(token)sessions.delete(token);return null}
  return s;
}
function requireAdmin(req,res,next){const user=currentAdmin(req);if(!user)return res.status(401).json({error:"Admin authentication required"});req.admin=user;next()}
function requireOwner(req,res,next){if(req.admin?.role!=="owner")return res.status(403).json({error:"Owner access required"});next()}

app.get("/health",async(req,res)=>{
  let database="not_configured";
  if(pool){try{await ensureDb();await pool.query("SELECT 1");database="connected"}catch(e){database="error"}}
  res.json({status:"ok",app:"Orca Enterprise",version:"1.3.0",database});
});
app.get("/api/services",(req,res)=>res.json([
 {id:"detailing",name:"Mobile Detailing",description:"Professional mobile vehicle care.",items:["Standard Car Wash","Interior Cleaning","Engine Wash","Wax & Polish","Undercarriage Wash","Headlight Restoration"]},
 {id:"residential",name:"Residential Cleaning",description:"Detailed cleaning for homes and living spaces."},
 {id:"commercial",name:"Commercial Cleaning",description:"Professional cleaning for offices, retail and guest houses."},
 {id:"transportation",name:"Transportation",description:"Safe and reliable transportation services.",items:["Orca School Pickup Service","Airport Transfer","Private Transport","Corporate Transport"]}
]));

app.post("/api/admin/login",async(req,res)=>{
  if(!pool||!ADMIN_PASSWORD)return res.status(503).json({error:"Admin authentication is not configured"});
  try{
    await ensureDb();
    const username=String(req.body.username||"").trim();
    const password=String(req.body.password||"");
    const r=await pool.query("SELECT id,username,password_hash,role FROM admin_users WHERE username=$1",[username]);
    if(!r.rowCount||!(await bcrypt.compare(password,r.rows[0].password_hash)))return res.status(401).json({error:"Incorrect username or password"});
    res.json({token:createSession(r.rows[0]),user:{username:r.rows[0].username,role:r.rows[0].role}});
  }catch(e){res.status(500).json({error:"Unable to sign in"})}
});
app.post("/api/admin/logout",requireAdmin,(req,res)=>{const token=(req.headers.authorization||"").replace(/^Bearer\s+/i,"");sessions.delete(token);res.json({ok:true})});
app.get("/api/admin/me",requireAdmin,(req,res)=>res.json({username:req.admin.username,role:req.admin.role}));

app.get("/api/admin/users",requireAdmin,requireOwner,async(req,res)=>{
  try{await ensureDb();const r=await pool.query("SELECT id,username,role,created_at FROM admin_users ORDER BY created_at ASC");res.json(r.rows)}
  catch(e){res.status(500).json({error:"Unable to load admin users"})}
});
app.post("/api/admin/users",requireAdmin,requireOwner,async(req,res)=>{
  const username=String(req.body.username||"").trim();
  const password=String(req.body.password||"");
  const role=req.body.role==="owner"?"owner":"staff";
  if(!/^[A-Za-z0-9._-]{3,40}$/.test(username))return res.status(400).json({error:"Username must be 3-40 letters, numbers, dots, underscores or hyphens"});
  if(password.length<12)return res.status(400).json({error:"Password must be at least 12 characters"});
  try{
    const hash=await bcrypt.hash(password,12);
    const r=await pool.query("INSERT INTO admin_users(username,password_hash,role) VALUES($1,$2,$3) RETURNING id,username,role,created_at",[username,hash,role]);
    res.status(201).json(r.rows[0]);
  }catch(e){res.status(409).json({error:"Username already exists"})}
});
app.delete("/api/admin/users/:id",requireAdmin,requireOwner,async(req,res)=>{
  try{
    const r=await pool.query("DELETE FROM admin_users WHERE id=$1 AND username<>$2 RETURNING id",[req.params.id,req.admin.username]);
    if(!r.rowCount)return res.status(400).json({error:"Cannot delete this account"});
    res.json({ok:true});
  }catch(e){res.status(500).json({error:"Unable to delete account"})}
});

app.get("/api/bookings",requireAdmin,async(req,res)=>{
  if(!pool)return res.status(503).json({error:"Database is not configured"});
  try{await ensureDb();const r=await pool.query("SELECT * FROM bookings ORDER BY created_at DESC");res.json(r.rows)}
  catch(e){res.status(500).json({error:"Unable to load bookings"})}
});
app.patch("/api/bookings/:id",requireAdmin,async(req,res)=>{
  if(!pool)return res.status(503).json({error:"Database is not configured"});
  const status=String(req.body.status||"").trim();
  if(!["New","Confirmed","Completed","Cancelled"].includes(status))return res.status(400).json({error:"Invalid status"});
  try{const r=await pool.query("UPDATE bookings SET status=$1 WHERE id=$2 RETURNING *",[status,req.params.id]);if(!r.rowCount)return res.status(404).json({error:"Booking not found"});res.json(r.rows[0])}
  catch(e){res.status(500).json({error:"Unable to update booking"})}
});
app.post("/api/bookings",async(req,res)=>{
  const {service,customerName,phone,email,address,scheduledAt,notes}=req.body||{};
  if(!service||!customerName||!phone)return res.status(400).json({error:"Service, customer name and phone are required"});
  if(pool){try{await ensureDb();const r=await pool.query("INSERT INTO bookings(service,customer_name,phone,email,address,scheduled_at,notes) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",[service,customerName,phone,email||null,address||null,scheduledAt||null,notes||null]);return res.status(201).json(r.rows[0])}catch(e){return res.status(500).json({error:"Booking could not be saved. Please try again."})}}
  res.status(503).json({error:"Booking database is temporarily unavailable"});
});
app.listen(port,()=>console.log("Orca Enterprise listening on "+port));