const express=require("express");
const crypto=require("crypto");
const bcrypt=require("bcryptjs");
const {Pool}=require("pg");
const app=express();
const port=process.env.PORT||3000;
const pool=process.env.DATABASE_URL?new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.NODE_ENV==="production"?{rejectUnauthorized:false}:false}):null;
const ADMIN_USERNAME=process.env.ADMIN_USERNAME||"admin";
const ADMIN_PASSWORD=process.env.ADMIN_PASSWORD||"";
const PUBLIC_APP_URL=process.env.PUBLIC_APP_URL||"";
const STRIPE_SECRET_KEY=process.env.STRIPE_SECRET_KEY||"";
const LYNK_PAYMENT_URL=process.env.LYNK_PAYMENT_URL||"https://abr.ge/nfaa6gu";
const sessions=new Map();
app.use(express.json());
app.use(express.urlencoded({extended:true}));
app.use(express.static("public"));
app.get("/favicon.ico",(req,res)=>res.sendFile(require("path").join(__dirname,"public","icons","orca.svg")));
app.get("/admin",(req,res)=>res.sendFile(require("path").join(__dirname,"public","admin.html")));
app.get("/creator",(req,res)=>res.sendFile(require("path").join(__dirname,"public","admin.html")));
app.get("/install",(req,res)=>res.sendFile(require("path").join(__dirname,"public","install.html")));
app.get("/staff",(req,res)=>res.sendFile(require("path").join(__dirname,"public","staff.html")));

async function ensureBookingsDb(){
  if(!pool)throw new Error("Database is not configured");
  await pool.query(`CREATE TABLE IF NOT EXISTS bookings(
    id SERIAL PRIMARY KEY, service TEXT NOT NULL, customer_name TEXT NOT NULL, phone TEXT NOT NULL,
    email TEXT, address TEXT, scheduled_at TEXT, notes TEXT, status TEXT NOT NULL DEFAULT 'New',
    amount_jmd NUMERIC(12,2), payment_status TEXT NOT NULL DEFAULT 'unpaid', stripe_session_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  const migrations=[
    "ALTER TABLE bookings ADD COLUMN IF NOT EXISTS email TEXT",
    "ALTER TABLE bookings ADD COLUMN IF NOT EXISTS address TEXT",
    "ALTER TABLE bookings ADD COLUMN IF NOT EXISTS scheduled_at TEXT",
    "ALTER TABLE bookings ADD COLUMN IF NOT EXISTS notes TEXT",
    "ALTER TABLE bookings ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'New'",
    "ALTER TABLE bookings ADD COLUMN IF NOT EXISTS amount_jmd NUMERIC(12,2)",
    "ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'unpaid'",
    "ALTER TABLE bookings ADD COLUMN IF NOT EXISTS stripe_session_id TEXT",
    "ALTER TABLE bookings ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()"
  ];
  for(const sql of migrations)await pool.query(sql);
  await pool.query("UPDATE bookings SET status='New' WHERE status IS NULL");
  await pool.query("UPDATE bookings SET payment_status='unpaid' WHERE payment_status IS NULL");
}

async function ensureDb(){
  if(!pool)return;
  await pool.query(`CREATE TABLE IF NOT EXISTS bookings(
    id SERIAL PRIMARY KEY, service TEXT NOT NULL, customer_name TEXT NOT NULL, phone TEXT NOT NULL,
    email TEXT, address TEXT, scheduled_at TEXT, notes TEXT, status TEXT NOT NULL DEFAULT 'New',
    amount_jmd NUMERIC(12,2), payment_status TEXT NOT NULL DEFAULT 'unpaid', stripe_session_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  await pool.query("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS amount_jmd NUMERIC(12,2)");
  await pool.query("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'unpaid'");
  await pool.query("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS stripe_session_id TEXT");
  await pool.query(`CREATE TABLE IF NOT EXISTS staff_members(
    id SERIAL PRIMARY KEY, full_name TEXT NOT NULL, phone TEXT NOT NULL, email TEXT,
    employee_id TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, active BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS staff_attendance(
    id SERIAL PRIMARY KEY, staff_id INTEGER NOT NULL REFERENCES staff_members(id) ON DELETE CASCADE,
    work_date DATE NOT NULL, checked_in_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(staff_id,work_date)
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
function requireAdmin(req,res,next){const user=currentAdmin(req);if(!user||user.role!=="owner")return res.status(401).json({error:"Creator authentication required"});req.admin=user;next()}
function requireOwner(req,res,next){if(req.admin?.role!=="owner")return res.status(403).json({error:"Owner access required"});next()}

app.get("/health",async(req,res)=>{
  let database="not_configured";
  if(pool){try{await ensureDb();await pool.query("SELECT 1");database="connected"}catch(e){database="error"}}
  res.json({status:"ok",app:"Orca Enterprise",version:"1.5.0",database,payment:"lynk"});
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
    if(!r.rowCount||r.rows[0].role!=="owner"||!(await bcrypt.compare(password,r.rows[0].password_hash)))return res.status(401).json({error:"Incorrect creator username or password"});
    res.json({token:createSession(r.rows[0]),user:{username:r.rows[0].username,role:r.rows[0].role}});
  }catch(e){res.status(500).json({error:"Unable to sign in"})}
});
app.post("/api/admin/logout",requireAdmin,(req,res)=>{const token=(req.headers.authorization||"").replace(/^Bearer\s+/i,"");sessions.delete(token);res.json({ok:true})});
app.get("/api/admin/me",requireAdmin,(req,res)=>res.json({username:req.admin.username,role:req.admin.role}));

async function createStripeCheckout(booking){
  if(!STRIPE_SECRET_KEY)return {error:"Online payments are not configured yet"};
  const amount=Math.round(Number(booking.amount_jmd||0));
  if(!Number.isFinite(amount)||amount<=0)return {error:"Orca has not set the payment amount for this booking yet"};
  const base=PUBLIC_APP_URL||"https://orca-enterprise-production-production.up.railway.app";
  const p=new URLSearchParams();
  p.set("mode","payment");
  p.set("success_url",base+"/?payment=success&booking_id="+booking.id+"&session_id={CHECKOUT_SESSION_ID}");
  p.set("cancel_url",base+"/?payment=cancelled&booking_id="+booking.id);
  p.set("line_items[0][quantity]","1");p.set("line_items[0][price_data][currency]","jmd");
  p.set("line_items[0][price_data][unit_amount]",String(amount));
  p.set("line_items[0][price_data][product_data][name]","Orca Enterprise - "+booking.service);
  p.set("line_items[0][price_data][product_data][description]","Booking #"+booking.id+" for "+booking.customer_name);
  if(booking.email)p.set("customer_email",booking.email);
  const response=await fetch("https://api.stripe.com/v1/checkout/sessions",{method:"POST",headers:{Authorization:"Basic "+Buffer.from(STRIPE_SECRET_KEY+":").toString("base64"),"Content-Type":"application/x-www-form-urlencoded"},body:p});
  const data=await response.json();if(!response.ok)throw new Error(data.error?.message||"Stripe checkout could not be created");
  await pool.query("UPDATE bookings SET stripe_session_id=$1,payment_status='pending' WHERE id=$2",[data.id,booking.id]);return {url:data.url};
}
app.get("/api/bookings/:id/payment-info",async(req,res)=>{
  if(!pool)return res.status(503).json({error:"Database is not configured"});
  try{await ensureDb();const r=await pool.query("SELECT id,service,customer_name,phone,amount_jmd,payment_status,status FROM bookings WHERE id=$1 AND phone=$2",[req.params.id,String(req.query.phone||"").trim()]);if(!r.rowCount)return res.status(404).json({error:"Booking not found. Check the booking number and phone number."});const b=r.rows[0];res.json({id:b.id,service:b.service,customerName:b.customer_name,amountJmd:b.amount_jmd,paymentStatus:b.payment_status,status:b.status,paymentAvailable:Boolean(LYNK_PAYMENT_URL&&Number(b.amount_jmd)>0)});}catch(e){res.status(500).json({error:"Unable to find booking"})}
});
app.post("/api/bookings/:id/pay",async(req,res)=>{
  if(!pool)return res.status(503).json({error:"Database is not configured"});
  try{await ensureDb();const r=await pool.query("SELECT * FROM bookings WHERE id=$1 AND phone=$2",[req.params.id,String(req.body.phone||"").trim()]);if(!r.rowCount)return res.status(404).json({error:"Booking not found"});const b=r.rows[0];if(b.payment_status==="paid")return res.json({paid:true,message:"This booking is already paid."});const amount=Number(b.amount_jmd||0);if(!LYNK_PAYMENT_URL||!Number.isFinite(amount)||amount<=0)return res.status(400).json({error:"Orca has not set the payment amount for this booking yet"});await pool.query("UPDATE bookings SET payment_status='pending' WHERE id=$1",[b.id]);res.json({url:LYNK_PAYMENT_URL,paymentMethod:"Lynk",bookingId:b.id,amountJmd:amount});}catch(e){res.status(500).json({error:"Unable to start Lynk payment"})}
});
app.post("/api/bookings/:id/lynk-paid",async(req,res)=>{
  if(!pool)return res.status(503).json({error:"Database is not configured"});
  try{await ensureDb();const r=await pool.query("SELECT id,payment_status FROM bookings WHERE id=$1 AND phone=$2",[req.params.id,String(req.body.phone||"").trim()]);if(!r.rowCount)return res.status(404).json({error:"Booking not found"});if(r.rows[0].payment_status==="paid")return res.json({paid:true,message:"This booking is already paid."});await pool.query("UPDATE bookings SET payment_status='pending_verification' WHERE id=$1",[r.rows[0].id]);res.json({ok:true,paymentStatus:"pending_verification",message:"Payment submitted for Lynk verification."});}catch(e){res.status(500).json({error:"Unable to update payment status"})}
});
app.get("/api/payments/confirm",async(req,res)=>{
  if(!pool||!STRIPE_SECRET_KEY)return res.status(503).json({error:"Online payments are not configured"});
  const sessionId=String(req.query.session_id||"");if(!sessionId)return res.status(400).json({error:"Missing payment session"});
  try{const response=await fetch("https://api.stripe.com/v1/checkout/sessions/"+encodeURIComponent(sessionId),{headers:{Authorization:"Basic "+Buffer.from(STRIPE_SECRET_KEY+":").toString("base64")}});const session=await response.json();if(!response.ok)return res.status(400).json({error:"Unable to verify payment"});const r=await pool.query("SELECT id FROM bookings WHERE stripe_session_id=$1",[session.id]);if(r.rowCount&&session.payment_status==="paid")await pool.query("UPDATE bookings SET payment_status='paid' WHERE id=$1",[r.rows[0].id]);res.json({paid:session.payment_status==="paid",bookingId:r.rows[0]?.id||null});}catch(e){res.status(500).json({error:"Unable to verify payment"})}
});
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

app.post("/api/staff/register",async(req,res)=>{
  if(!pool)return res.status(503).json({error:"Database is not configured"});
  const fullName=String(req.body.fullName||"").trim(),phone=String(req.body.phone||"").trim(),email=String(req.body.email||"").trim(),employeeId=String(req.body.employeeId||"").trim().toUpperCase(),password=String(req.body.password||"");
  if(fullName.length<2||fullName.length>100||phone.length<7||phone.length>30||!/^[A-Z0-9._-]{3,40}$/.test(employeeId)||password.length<12)return res.status(400).json({error:"Enter valid staff details; password must be at least 12 characters."});
  try{await ensureDb();const hash=await bcrypt.hash(password,12);const r=await pool.query("INSERT INTO staff_members(full_name,phone,email,employee_id,password_hash) VALUES($1,$2,$3,$4,$5) RETURNING id,full_name,employee_id,active",[fullName,phone,email||null,employeeId,hash]);res.status(201).json({message:"Registration submitted. Creator approval is required before daily check-in.",staff:r.rows[0]});}catch(e){res.status(409).json({error:"That employee ID is already registered"});}
});
app.post("/api/staff/login",async(req,res)=>{
  if(!pool)return res.status(503).json({error:"Database is not configured"});
  try{await ensureDb();const employeeId=String(req.body.employeeId||"").trim().toUpperCase(),password=String(req.body.password||"");const r=await pool.query("SELECT * FROM staff_members WHERE employee_id=$1",[employeeId]);if(!r.rowCount||!(await bcrypt.compare(password,r.rows[0].password_hash)))return res.status(401).json({error:"Incorrect employee ID or password"});const staff=r.rows[0];if(!staff.active)return res.status(403).json({error:"Your staff registration is awaiting creator approval"});const token=createSession({id:staff.id,username:staff.employee_id,role:"staff"});await pool.query("INSERT INTO staff_attendance(staff_id,work_date) VALUES($1,CURRENT_DATE) ON CONFLICT(staff_id,work_date) DO NOTHING",[staff.id]);res.json({token,staff:{id:staff.id,fullName:staff.full_name,employeeId:staff.employee_id}});}catch(e){res.status(500).json({error:"Unable to sign in"});}
});
function requireStaff(req,res,next){const token=(req.headers.authorization||"").replace(/^Bearer\s+/i,"");const s=sessions.get(token);if(!s||s.role!=="staff"||s.expires<Date.now())return res.status(401).json({error:"Staff login required"});req.staff=s;next();}
app.get("/api/staff/me",requireStaff,async(req,res)=>{try{const r=await pool.query("SELECT s.full_name,s.employee_id,a.checked_in_at FROM staff_members s LEFT JOIN staff_attendance a ON a.staff_id=s.id AND a.work_date=CURRENT_DATE WHERE s.id=$1",[req.staff.userId]);if(!r.rowCount)return res.status(404).json({error:"Staff account not found"});res.json(r.rows[0]);}catch(e){res.status(500).json({error:"Unable to load staff status"});}});
app.post("/api/staff/check-in",requireStaff,async(req,res)=>{try{const r=await pool.query("INSERT INTO staff_attendance(staff_id,work_date) VALUES($1,CURRENT_DATE) ON CONFLICT(staff_id,work_date) DO UPDATE SET checked_in_at=staff_attendance.checked_in_at RETURNING checked_in_at",[req.staff.userId]);res.json({checkedInAt:r.rows[0].checked_in_at});}catch(e){res.status(500).json({error:"Unable to record check-in"});}});
app.post("/api/staff/logout",requireStaff,(req,res)=>{const token=(req.headers.authorization||"").replace(/^Bearer\s+/i,"");sessions.delete(token);res.json({ok:true});});
app.get("/api/admin/staff",requireAdmin,requireOwner,async(req,res)=>{try{const r=await pool.query("SELECT id,full_name,phone,email,employee_id,active,created_at FROM staff_members ORDER BY created_at DESC");res.json(r.rows);}catch(e){res.status(500).json({error:"Unable to load staff"});}});
app.patch("/api/admin/staff/:id",requireAdmin,requireOwner,async(req,res)=>{try{const r=await pool.query("UPDATE staff_members SET active=$1 WHERE id=$2 RETURNING id,full_name,employee_id,active",[Boolean(req.body.active),req.params.id]);if(!r.rowCount)return res.status(404).json({error:"Staff member not found"});res.json(r.rows[0]);}catch(e){res.status(500).json({error:"Unable to update staff"});}});
app.get("/api/admin/attendance",requireAdmin,requireOwner,async(req,res)=>{try{const r=await pool.query("SELECT s.full_name,s.employee_id,a.work_date,a.checked_in_at FROM staff_attendance a JOIN staff_members s ON s.id=a.staff_id ORDER BY a.work_date DESC,a.checked_in_at DESC LIMIT 200");res.json(r.rows);}catch(e){res.status(500).json({error:"Unable to load attendance"});}});
app.get("/api/bookings",requireAdmin,async(req,res)=>{
  if(!pool)return res.status(503).json({error:"Database is not configured"});
  try{await ensureDb();const r=await pool.query("SELECT * FROM bookings ORDER BY created_at DESC");res.json(r.rows)}
  catch(e){res.status(500).json({error:"Unable to load bookings"})}
});
app.patch("/api/bookings/:id",requireAdmin,async(req,res)=>{
  if(!pool)return res.status(503).json({error:"Database is not configured"});
  const status=String(req.body.status||"").trim();
  if(!["New","Confirmed","Completed","Cancelled"].includes(status))return res.status(400).json({error:"Invalid status"});
  const amount=req.body.amountJmd===null||req.body.amountJmd===""?null:Number(req.body.amountJmd);
  if(amount!==null&&(!Number.isFinite(amount)||amount<0||amount>100000000))return res.status(400).json({error:"Invalid payment amount"});
  try{const r=await pool.query("UPDATE bookings SET status=$1,amount_jmd=$2 WHERE id=$3 RETURNING *",[status,amount,req.params.id]);if(!r.rowCount)return res.status(404).json({error:"Booking not found"});res.json(r.rows[0])}
  catch(e){res.status(500).json({error:"Unable to update booking"})}
});
app.post("/api/bookings",async(req,res)=>{
  const {service,customerName,phone,email,address,scheduledAt,notes}=req.body||{};
  const allowedServices=["Mobile Detailing","Residential Cleaning","Commercial Cleaning","Transportation"];
  if(!service||!customerName||!phone)return res.status(400).json({error:"Service, customer name and phone are required"});
  if(!allowedServices.includes(String(service)))return res.status(400).json({error:"Please select a valid Orca Enterprise service"});
  if(String(customerName).trim().length<2||String(customerName).trim().length>100)return res.status(400).json({error:"Full name must be 2-100 characters"});
  if(String(phone).trim().length<7||String(phone).trim().length>30)return res.status(400).json({error:"Please enter a valid phone number"});
  if(email&&String(email).length>254)return res.status(400).json({error:"Email address is too long"});
  if(notes&&String(notes).length>2000)return res.status(400).json({error:"Notes are limited to 2000 characters"});
  if(pool){
    try{
      await ensureBookingsDb();
      const values=[
        String(service).trim(),
        String(customerName).trim(),
        String(phone).trim(),
        email?String(email).trim():null,
        address?String(address).trim():null,
        scheduledAt?String(scheduledAt).trim():null,
        notes?String(notes).trim():null
      ];
      const r=await pool.query(
        "INSERT INTO bookings(service,customer_name,phone,email,address,scheduled_at,notes,status,payment_status) VALUES($1,$2,$3,$4,$5,$6,$7,'New','unpaid') RETURNING *",
        values
      );
      return res.status(201).json(r.rows[0]);
    }catch(e){
      console.error("BOOKING_SAVE_ERROR",{
        code:e.code,message:e.message,detail:e.detail,hint:e.hint,
        table:e.table,column:e.column,constraint:e.constraint
      });
      return res.status(500).json({error:"Booking could not be saved. Please try again.",code:"BOOKING_SAVE_ERROR"});
    }
  }
  res.status(503).json({error:"Booking database is temporarily unavailable"});
});
app.listen(port,()=>console.log("Orca Enterprise listening on "+port));