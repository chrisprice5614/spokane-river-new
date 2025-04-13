require("dotenv").config() // Makes it so we can access .env file
const sanitizeHTML = require("sanitize-html")//npm install sanitize-html
const jwt = require("jsonwebtoken")//npm install jsonwebtoken dotenv
const bcrypt = require("bcrypt") //npm install bcrypt
const cookieParser = require("cookie-parser")//npm install cookie-parser
const express = require("express")//npm install ejs
const db = require("better-sqlite3")("ourApp.db") //npm install better-sqlite3
db.pragma("journal_mode = WAL") //Makes it faster
//npm install nodemon


const linkRegex = /(https?\:\/\/)?(www\.)?[^\s]+\.[^\s]+/g

//database setup here
const createTables = db.transaction(() => {
    db.prepare(
        `
        CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username STRING NOT NULL UNIQUE,
        firstname STRING NOT NULL,
        lastname STRING NOT NULL,
        email STRING NOT NULL UNIQUE,
        password STRING NOT NULL,
        admin BOOL NOT NULL
        )
        `
    ).run()

    db.prepare(
        `
        CREATE TABLE IF NOT EXISTS posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        createdDate TEXT,
        title STRING NOT NULL,
        content STRING NOT NULL
        )
        `
    ).run()

    db.prepare(
        `
        CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        location TEXT NOT NULL,
        title STRING NOT NULL,
        content STRING NOT NULL
        )
        `
    ).run()

})

createTables();


const app = express()

app.use(express.urlencoded({extended: false}))// This makes it so we can easily access requests

app.use(express.static("public")) //Using public folder
app.use(cookieParser())

app.set("view engine", "ejs")
//Views is the folder they'll look in

function sharedPostValidation(req) {
    const errors = []

    if(typeof req.body.title !== "string") req.body.title = ""
    if(typeof req.body.body !== "string") req.body.body = ""

    //trim - sanitize or strip out html
    req.body.title = sanitizeHTML(req.body.title.trim(), {allowedTags: [], allowedAttributes: {}})
    req.body.body = sanitizeHTML(req.body.body.trim(), {allowedTags: [], allowedAttributes: {}})

    if(!req.body.title) errors.push("you must provide a title")
    if(!req.body.body) errors.push("you must provide content")

    return errors
}

function replacer(matched) {
    let withProtocol = matched
  
    if(!withProtocol.startsWith("http")) {
      withProtocol = "http://" + matched
    }
  
    const newStr = `<a
      target="_blank"
      href="${withProtocol}"
    >
      ${matched}
    </a>`

    
  
    return newStr
  }

//Middleware
app.use(function (req, res, next) {
    res.locals.errors = []

    // try to decode incoming cookie
    try {
        const decoded = jwt.verify(req.cookies.spokaneYsa, process.env.JWTSECRET)
        req.user = decoded


        const adminStatement = db.prepare("SELECT * FROM users WHERE id = ?")
        req.admin = adminStatement.get(req.user.userid).admin
    } catch(err){
        req.user = false
        req.admin = false
    }

    res.locals.user = req.user
    res.locals.admin = req.admin
    console.log(req.user)

    next()
})


//check for login
function mustBeLoggedIn(req, res, next){
    if(req.user) {
        return next()
    }
    else
    {
        return res.redirect("/")
    }
}

//check for admin
function mustBeAdmin(req, res, next){
    if(req.admin) {
        return next()
    }
    else
    {
        return res.redirect("/")
    }
}

function getDayName(day)
    {
        const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

        return dayNames[day];
    }

//Get commands
app.get("/", (req,res) => {
    //Getting all the events, ordered by date
    const allEventsStatement = db.prepare("SELECT * FROM events ORDER BY date")
    const allEvents = allEventsStatement.all()

    const allPostsStatement = db.prepare("SELECT * FROM posts ORDER BY createdDate DESC")
    let allPosts = allPostsStatement.all()

    allPosts.forEach(post => {
        post.content = post.content.replace(linkRegex, replacer)

    })

    allEvents.forEach(event => {

        event.dayName = getDayName( new Date(event.date).getDay())
        event.locale = "https://www.google.com/maps/search/"+event.location.replace(/ /g, '+');
        event.content = event.content.replace(linkRegex, replacer)

    })

    res.render("homepage",{allEvents,allPosts})
})


app.get("/events", (req,res) => {
    //Getting all the events, ordered by date
    const allEventsStatement = db.prepare("SELECT * FROM events ORDER BY date")
    const allEvents = allEventsStatement.all()

    allEvents.forEach(event => {

        event.dayName = getDayName( new Date(event.date).getDay())
        event.locale = "https://www.google.com/maps/search/"+event.location.replace(/ /g, '+');
        event.content = event.content.replace(linkRegex, replacer)

    })

    res.render("events",{allEvents})
})



app.get("/login", (req,res) =>{
    //Showing that we're not registering
    const register = false;

    //If we're logged in, we don't need to be here!
    if(req.user)
    {
        res.redirect("/")
    }

    res.render("login-register",{register})
})

app.get("/register", (req,res) =>{
    //Showing that we're not registering
    const register = true;

    //If we're logged in, we don't need to be here!
    if(req.user)
    {
        res.redirect("/")
    }

    res.render("login-register",{register})
})





app.get("/edit-event/:id", mustBeAdmin, (req,res) =>{

    const statement = db.prepare("SELECT * FROM events WHERE id = ?")
    const event = statement.get(req.params.id)

    if(!event) {
        return res.redirect("/")
    }

    

    res.render("edit-event",{event})
})

app.get("/delete-event/:id", mustBeAdmin, (req,res) =>{
    const statement = db.prepare("SELECT * FROM events WHERE id = ?")
    const event = statement.get(req.params.id)

    if(!event) {
        return res.redirect("/")
    }

    //Always setup as statement = prepare, then do statement.run/statement.get, and then the params
    const deleteStatement = db.prepare("DELETE FROM events WHERE id = ?")
    deleteStatement.run(req.params.id)
    
    res.redirect("/")
})


app.get("/logout", (req,res) => {
    res.clearCookie("spokaneYsa")
    res.redirect("/")
})

app.get("/create-post", mustBeAdmin, (req,res) =>{

    res.render("create-post")
})

app.get("/create-event", mustBeAdmin, (req,res) =>{

    res.render("create-event")
})


app.get("/event/:id", (req,res)=>{
    //select everything from posts (posts.*) then select only username from users (users.username)
    const statement = db.prepare("SELECT * FROM events WHERE id = ?")
    const event = statement.get(req.params.id)


    if(!event) {
        return res.redirect("/")
    }

    const dayName = getDayName( new Date(event.date).getDay())
    const locale = "https://www.google.com/maps/search/"+event.location.replace(/ /g, '+');
    const mapAddy = event.location.replace(/ /g, '+');

    event.content = event.content.replace(linkRegex, replacer)

    res.render("event", {event, dayName, locale, mapAddy})
})

//Post requests

app.post("/delete-post/:id",mustBeAdmin, (req,res) => {
    const statement = db.prepare("SELECT * FROM posts WHERE id = ?")
    const post = statement.get(req.params.id)

    if(!post) {
        return res.redirect("/")
    }

    //Always setup as statement = prepare, then do statement.run/statement.get, and then the params
    const deleteStatement = db.prepare("DELETE FROM posts WHERE id = ?")
    deleteStatement.run(req.params.id)

    res.redirect("/")
})

//Registering
app.post("/register", (req, res) =>{
    const errors = []

    if (typeof req.body.username !== "string") req.body.username = ""
    if (typeof req.body.password !== "string") req.body.password = ""
    if (typeof req.body.firstname !== "string") req.body.firstname = ""
    if (typeof req.body.lastname !== "string") req.body.lastname = ""
    if (typeof req.body.email !== "string") req.body.email = ""

    req.body.username = req.body.username.trim()
    req.body.firstname = req.body.firstname.trim()
    req.body.lastname = req.body.lastname.trim()
    req.body.email = req.body.email.trim()

    if(!req.body.username) errors.push("You must provide a username.")
    if(req.body.username && req.body.username.length < 3) errors.push("Your username must have at least 3 characters")
    if(req.body.username && req.body.username.length > 20) errors.push("Your username can have max 20 characters")
    if(req.body.username && !req.body.username.match(/^[a-zA-Z0-9]+$/)) errors.push("Username can only contain letters and numbers.")

    if(!req.body.password) errors.push("You must provide a password.")
    if(req.body.password && req.body.password.length < 6) errors.push("Your password must have at least 3 characters")
    if(req.body.password && req.body.password.length > 20) errors.push("Your password can have max 10 characters")

    if(!req.body.firstname) errors.push("You must provide a first name.")
    if(!req.body.lastname) errors.push("You must provide a last name.")
    if(!req.body.email) errors.push("You must provide an email.")

    //Check if username exists
    const usernameStatement = db.prepare("SELECT * FROM users WHERE username = ?")
    const usernameCheck = usernameStatement.get(req.body.username)

    //Check if email exists
    const emailStatement = db.prepare("SELECT * FROM users WHERE email = ?")
    const emailCheck = emailStatement.get(req.body.email)

    if(usernameCheck) errors.push("Username is already taken.")
    if(emailCheck) errors.push("Email is already taken.")

    if(errors.length > 0)
    {
        const register = true;
        //if there's an error, we return to the homepage and let them know there's an issue
        return res.render("login-register", {errors,register})
    }

    
    
    // Save the new user into a database
    const salt = bcrypt.genSaltSync(10)
    req.body.password = bcrypt.hashSync(req.body.password, salt)

    const ourStatement = db.prepare("INSERT INTO users (username, password, firstname, lastname, email, admin) VALUES (? , ? , ? , ? , ? , ?)")
    const result = ourStatement.run(req.body.username, req.body.password, req.body.firstname, req.body.lastname, req.body.email, 0)

    const lookupStatement = db.prepare("SELECT * FROM users WHERE ROWID = ?")
    const ourUser = lookupStatement.get(result.lastInsertRowid)

    // log the user in by giving them a cookie
    const ourTokenValue = jwt.sign({exp: Math.floor(Date.now() / 1000) + (60*60*24), userid: ourUser.id, username: ourUser.username}, process.env.JWTSECRET) //Creating a token for logging in

    res.cookie("spokaneYsa",ourTokenValue, {
        httpOnly: true,
        secure: true,
        sameSite: "strict",
        maxAge: 1000 * 60 * 60 * 24
    }) //name, string to remember,


    res.redirect("/")
    
})


//logging in
app.post("/login", (req, res) => {
    let errors = []

    if (typeof req.body.username !== "string") req.body.username = ""
    if (typeof req.body.password !== "string") req.body.password = ""

    req.body.username = req.body.username.trim()

    if(req.body.username == "") errors=["Invalid username/password"]
    if(req.body.password == "") errors=["Invalid username/password"]

    if(errors.length) {
        return res.render("login", {errors}) //returning to the login page while also passing the object "errors"
    }

    const userInQuestionStatement = db.prepare("SELECT * FROM users WHERE USERNAME = ?") //Select *(any) from 'name of table'
    const userInQuestion = userInQuestionStatement.get(req.body.username)

    if(!userInQuestion) {
         errors=["Invalid username/password"]
         return res.render("login", {errors})
    }


    const matchOrNot = bcrypt.compareSync(req.body.password, userInQuestion.password)
    if(!matchOrNot)
    {
        errors=["Invalid username/password"]
        return res.render("login", {errors})
    }

    // log the user in by giving them a cookie
    const ourTokenValue = jwt.sign({exp: Math.floor(Date.now() / 1000) + (60*60*24), userid: userInQuestion.id, username: userInQuestion.username}, process.env.JWTSECRET) //Creating a token for logging in

    res.cookie("spokaneYsa",ourTokenValue, {
        httpOnly: true,
        secure: true,
        sameSite: "strict",
        maxAge: 1000 * 60 * 60 * 24
    }) //name, string to remember,

    

    //redirection
    res.redirect("/")
})

app.post("/create-post",mustBeAdmin, (req, res)=>{
    const errors = sharedPostValidation(req)

    if(errors.length) {
        return res.render("create-post",{errors})
    }

    // save into database
    const ourStatement = db.prepare("INSERT INTO posts (title,content,createdDate) VALUES (?,?,?)")
    const result = ourStatement.run(req.body.title, req.body.body, new Date().toISOString())

    const getPostStatement = db.prepare("SELECT * FROM posts WHERE ROWID = ?")
    const realPost = getPostStatement.get(result.lastInsertRowid)

    res.redirect("/")
})


app.post("/create-event",mustBeAdmin, (req, res)=>{
    const errors = sharedPostValidation(req)

    if(errors.length) {
        return res.render("create-event",{errors})
    }

    // save into database
    const ourStatement = db.prepare("INSERT INTO events (title,content,location,date) VALUES (?,?,?,?)")
    const result = ourStatement.run(req.body.title, req.body.body, req.body.location, req.body.date)

    const getEventStatement = db.prepare("SELECT * FROM events WHERE ROWID = ?")
    const realEvent = getEventStatement.get(result.lastInsertRowid)

    res.redirect(`/event/${realEvent.id}`)
})

app.post("/edit-event/:id",mustBeAdmin, (req, res)=>{
    const errors = sharedPostValidation(req)

    if(errors.length) {
        return res.render("create-event",{errors})
    }

    const statement = db.prepare("SELECT * FROM events WHERE id = ?")
    const event = statement.get(req.params.id)

    if(!event) {
        return res.redirect("/")
    }

    if(errors.length)
    {
        return res.render("edit-post",{errors})
    }

    // save into database
    const updateStatement = db.prepare("UPDATE events set title = ?, content = ?, location = ?, date = ? WHERE id = ?")
    updateStatement.run(req.body.title, req.body.body, req.body.location, req.body.date, req.params.id)

    res.redirect(`/event/${req.params.id}}`)
})


//What port we're listening on
app.listen(3007)


////npm run dev
