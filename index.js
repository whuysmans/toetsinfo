const express = require('express')
const app = express()
let port = process.env.PORT || 3000
const axios = require('axios')
let school = process.env.SCHOOL
let quizID = 0
let courseID = 0
let token = '' 
const fs = require('fs')
const path = require('path')
const parse = require('parse-link-header')
const puppeteer = require('puppeteer')
let state = ''
let html = '<html><head><meta http-equiv="Content-Type" content="text/html; charset=UTF-8"></head><body><ul>'
const credentials = {
	client: {
		id: process.env.CLIENTID,
		secret: process.env.SECRET
	},
	auth: {
		tokenHost: process.env.SCHOOL,
		authorizePath: '/login/oauth2/auth',
		tokenPath: '/login/oauth2/token'
	}
}
let oauth2 = null
let authorizationUri = null
let shuffle = false
let showCorrect = false
const { check, validationResult } = require('express-validator')

// login link
app.get('/', ( req, res ) => {
	res.send('<h2 class="form"><a href="/auth">Login via Canvas</a></h2>')
} )

// uri was built on app startup; ask Canvas for the code
app.get('/auth', ( req, res ) => {
	console.log( authorizationUri )
	res.redirect( authorizationUri )
})

// ask for the access token
app.get('/callback', async ( req, res ) => {
	const { code } = req.query
	const options = {
		code
	}
	try {
		const result = await oauth2.authorizationCode.getToken( options )
		const tokenObj = oauth2.accessToken.create( result )
		token = tokenObj.token.access_token
		if ( req.query.state !== state ) {
			return res.sendStatus(401)
		}
		console.log( 'token', token )
		// everything ok? go to start
		res.redirect('/start')
		// return res.status(200).json(token)
	} catch ( e ) {
		console.log( e )
	}
})

// show the form with input fields
app.get('/start', ( req, res ) => {
	res.sendFile( path.join( __dirname + '/start.html' ) )
} )

const createSubmissionRow = ( start, end, email ) => {
	html += `<li>start: ${ start } end: ${ end } user: ${ email }</li>`
}

const getRandomIdent = () => {
	return Math.random().toString(36).substring(4)
}

const shuffleArray = arr => arr
	.map( a => [ Math.random(), a ] )
	.sort( ( a, b ) => a[0] - b[0] )
	.map( a => a[1] )

const getUserEmail = async ( userId ) => {
	let userURL = `${ school }/api/v1/users/${ userId }`
	let user = await axios( {
		method: 'GET',
		url: userURL,
		headers: {
			'Authorization': `Bearer ${ token }`	
		}
	} )
	return user.data.email
}

// on form submit, launch the Canvas API request
app.get('/test', [
	check( 'course' ).isLength({ min: 1, max: 10 }),
	check( 'course' ).isNumeric(),
	check( 'assignment' ).isLength({ min: 2, max: 10 }),
	check( 'assignment' ).isNumeric()
], async ( req, res ) => {
	const errors = validationResult( req )
	if ( ! errors.isEmpty() ) {
		return res.status( 422 ).json( { errors: errors.array() } )
	}
	quizID = req.query.assignment
	courseID = req.query.course
	
	// console.log( req.query )
	// token = `Bearer ${ req.query.token }`
	let quizURL = `${ school }/api/v1/courses/${ courseID }/quizzes/${ quizID }/submissions`
	let result = []
	try {
		let keepGoing = true
		while ( keepGoing ) {
			let response = await axios({
				method: 'GET',
				url: quizURL,
				headers: {
					'Authorization': `Bearer ${ token }`
				}
			})
			console.log( response.data )
			let submissions = response.data.quiz_submissions
			let sortedSubmissions = submissions.sort( ( a, b ) => new Date( b.started_at ) - new Date( a.started_at) ).reverse()
			sortedSubmissions.map( ( submission ) => {
				getUserEmail( submission.user_id ).then( ( email ) => { 
					console.log( Date.parse( submission.started_at ) )
					let startDate = new Date( Date.parse( submission.started_at ) ).toLocaleString( 'nl-BE' )
					let endDate = new Date( Date.parse( submission.finished_at ) ).toLocaleString( 'nl-BE' )
					createSubmissionRow( startDate, endDate, email ) 
				} )
			} )
			// handle pagination
			let parsed = parse( response.headers.link )
			if( parseInt( parsed.current.page ) >= parseInt( parsed.last.page ) ) {
				keepGoing = false
			} else {
				quizURL = parsed.next.url
			}
		}
		html += '</ul></body></html>'
		const ts = new Date().getTime()
		const outFile = path.join( __dirname, `quiz-submissions-${ ts }.pdf` )
		showCorrect = false
		shuffle = false
		await createHTML( html, outFile, res )
		// res.download( outFile )
		html = '<html><head><meta http-equiv="Content-Type" content="text/html; charset=UTF-8"></head><body>'
	} catch ( err ) {
		console.log( err )
	}
} )

async function createHTML ( str, file, res ) {
	console.log( file )
	const chromeOptions = {
		headless: true,
		defaultViewport: null,
		args: [
			 "--incognito",
			 "--no-sandbox",
			 "--single-process",
			 "--no-zygote"
		],
  }
	const browser = await puppeteer.launch( chromeOptions )
	const page = await browser.newPage()
	await page.setContent( str )
	await page.pdf( { path: file, format: 'A4' } )
	res.download( file )
	await browser.close()	
}

app.get( '/logout', async ( req, res ) => {
	let logoutURL = `${ school }/login/oauth2/token`
	console.log( logoutURL )
	await axios.delete( logoutURL, { headers: { 'Authorization': `Bearer ${ token }`	} } )
	token = ''
} )

// on app creation, set the oauth2 parameters
// TODO state and scope
app.listen( port, () => {
	state = getRandomIdent()
	oauth2 = require('simple-oauth2').create( credentials )
	authorizationUri = oauth2.authorizationCode.authorizeURL({
		// redirect_uri: 'http://localhost:3000/callback',
		redirect_uri: `${ process.env.APPURL }/callback`,
		scope: `url:GET|/api/v1/courses/:course_id/quizzes/:quiz_id/submissions url:GET|/api/v1/users/:id`,
		state: state 
	})
} )

app.use( '/css', express.static( path.join( __dirname, 'css') ) )