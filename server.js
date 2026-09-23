const express=require("express");
const {Pool}=require("pg");
const app=express();
const port=process.env.PORT||3000;
const pool=process.env.DATABASE_URL?new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.NODE_ENV==="production"?{rejectUnauthorized:false}:false}):null;
app.use(express.json());
app.use(express.static("public"));
app.get("/health",async(req,res)=>{
  let database="not_configured";
  if(pool){try{await pool.query("SELECT 1");database="connected"}catch(e){database="error"}}
  res.json({status:"ok",app:"Orca Enterprise",version:"1.1.0",database});
});
app.get("/api/services",(req,res)=>res.json([
 {id:"detailing",name:"Mobile Detailing",description:"Professional mobile vehicle care.",items:["Standard Car Wash","Interior Cleaning","Engine Wash","Wax & Polish","Undercarriage Wash","Headlight Restoration"]},
 {id:"residential",name:"Residential Cleaning",description:"Detailed cleaning for homes and living spaces."},
 {id:"commercial",name:"Commercial Cleaning",description:"Professional cleaning for offices, retail and guest houses."},
 {id:"transportation",name:"Transportation",description:"Safe and reliable transportation services.",items:["Orca School Pickup Service","Airport Transfer","Private Transport","Corporate Transport"]}
]));
app.post("/api/bookings",async(req,res)=>{
  const {service,customerName,phone,scheduledAt}=req.body||{};
  if(!service||!customerName||!phone)return res.status(400).json({error:"service, customerName and phone are required"});
  if(pool){
    await pool.query("CREATE TABLE IF NOT EXISTS bookings(id SERIAL PRIMARY KEY,service TEXT NOT NULL,customer_name TEXT NOT NULL,phone TEXT NOT NULL,scheduled_at TEXT,created_at TIMESTAMPTZ DEFAULT NOW())");
    const r=await pool.query("INSERT INTO bookings(service,customer_name,phone,scheduled_at) VALUES($1,$2,$3,$4) RETURNING *",[service,customerName,phone,scheduledAt||null]);
    return res.status(201).json(r.rows[0]);
  }
  res.status(201).json({id:"local-"+Date.now(),service,customerName,phone,scheduledAt:scheduledAt||null});
});
app.listen(port,()=>console.log("Orca Enterprise listening on "+port));