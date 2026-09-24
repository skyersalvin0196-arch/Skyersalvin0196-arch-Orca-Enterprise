const express=require("express");
const crypto=require("crypto");
const {Pool}=require("pg");
const app=express();
const port=process.env.PORT||3000;
const pool=process.env.DATABASE_URL?new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.NODE_ENV==="production"?{rejectUnauthorized:false}:false}):null;
const ADMIN_PASSWORD=process.env.ADMIN_PASSWORD||"";
app.use(express.json());
app.use(express.urlencoded({extended:true}));
app.use(express.static("public"));

async function ensureDb(){
  if(!pool) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS bookings(
    id SERIAL PRIMARY KEY,
    service TEXT NOT NULL,
    customer_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT,
    address TEXT,
    scheduled_at TEXT,
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'New',
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);
}
function adminToken(){
  return crypto.createHmac("sha256",ADMIN_PASSWORD).update("orca-admin-session").digest("hex");
}
function requireAdmin(req,res,next){
  const token=(req.headers.authorization||"").replace(/^Bearer\s+/i,"");
  if(!ADMIN_PASSWORD||token!==adminToken()) return res.status(401).json({error:"Admin authentication required"});
  next();
}
app.get("/health",async(req,res)=>{
  let database="not_configured";
  if(pool){try{await ensureDb();await pool.query("SELECT 1");database="connected"}catch(e){database="error"}}
  res.json({status:"ok",app:"Orca Enterprise",version:"1.2.0",database});
});
app.get("/api/services",(req,res)=>res.json([
 {id:"detailing",name:"Mobile Detailing",description:"Professional mobile vehicle care.",items:["Standard Car Wash","Interior Cleaning","Engine Wash","Wax & Polish","Undercarriage Wash","Headlight Restoration"]},
 {id:"residential",name:"Residential Cleaning",description:"Detailed cleaning for homes and living spaces."},
 {id:"commercial",name:"Commercial Cleaning",description:"Professional cleaning for offices, retail and guest houses."},
 {id:"transportation",name:"Transportation",description:"Safe and reliable transportation services.",items:["Orca School Pickup Service","Airport Transfer","Private Transport","Corporate Transport"]}
]));
app.post("/api/admin/login",(req,res)=>{
  if(!ADMIN_PASSWORD||req.body.password!==ADMIN_PASSWORD) return res.status(401).json({error:"Incorrect admin password"});
  res.json({token:adminToken()});
});
app.get("/api/bookings",requireAdmin,async(req,res)=>{
  if(!pool) return res.status(503).json({error:"Database is not configured"});
  try{await ensureDb();const r=await pool.query("SELECT * FROM bookings ORDER BY created_at DESC");res.json(r.rows)}
  catch(e){res.status(500).json({error:"Unable to load bookings"})}
});
app.patch("/api/bookings/:id",requireAdmin,async(req,res)=>{
  if(!pool) return res.status(503).json({error:"Database is not configured"});
  const status=String(req.body.status||"").trim();
  if(!["New","Confirmed","Completed","Cancelled"].includes(status)) return res.status(400).json({error:"Invalid status"});
  try{const r=await pool.query("UPDATE bookings SET status=$1 WHERE id=$2 RETURNING *",[status,req.params.id]);if(!r.rowCount)return res.status(404).json({error:"Booking not found"});res.json(r.rows[0])}
  catch(e){res.status(500).json({error:"Unable to update booking"})}
});
app.post("/api/bookings",async(req,res)=>{
  const {service,customerName,phone,email,address,scheduledAt,notes}=req.body||{};
  if(!service||!customerName||!phone)return res.status(400).json({error:"Service, customer name and phone are required"});
  if(pool){
    try{
      await ensureDb();
      const r=await pool.query("INSERT INTO bookings(service,customer_name,phone,email,address,scheduled_at,notes) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
        [service,customerName,phone,email||null,address||null,scheduledAt||null,notes||null]);
      return res.status(201).json(r.rows[0]);
    }catch(e){return res.status(500).json({error:"Booking could not be saved. Please try again."})}
  }
  res.status(503).json({error:"Booking database is temporarily unavailable"});
});
app.listen(port,()=>console.log("Orca Enterprise listening on "+port));