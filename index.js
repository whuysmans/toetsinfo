const express = require('express')
const app = express()
let port = process.env.PORT || 3000
const axios = require('axios')
let school = process.env.SCHOOL
let quizID = 0
let courseID = 0
let token = '' 
const PDFDocument = require('pdfkit')
const fs = require('fs')
const path = require('path')
const parse = require('parse-link-header')
// TODO put these in Heroku process.ENV
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

const createAnswerRow = ( doc, answer, type ) => {
	doc
		.fontSize( 9 )
		.text( type === 'fill_in_multiple_blanks_question' ?
			`${ answer.text } (${ answer.blank_id })\n` :
			`${ answer.text }\n`, {
				indent: 10
			}	
		)
}

const generateQuestionRow = ( doc, question ) => {
	doc
		.fontSize( 12 )
		.text( `${ question.question_text }\n\n` )
}

const generateSpace = ( doc ) => {
	doc
		.text( `\n\n` )
}

// on form submit, launch the Canvas API request
app.get('/test', [
	check( 'course' ).isLength({ min: 4, max: 10 }),
	check( 'course' ).isNumeric(),
	check( 'assignment' ).isLength({ min: 4, max: 10 }),
	check( 'assignment' ).isNumeric()
], async ( req, res ) => {
	const errors = validationResult( req )
	if ( ! errors.isEmpty() ) {
		return res.status( 422 ).json( { errors: errors.array() } )
	}
	quizID = req.query.assignment
	courseID = req.query.course
	// token = `Bearer ${ req.query.token }`
	let quizURL = `${ school }/api/v1/courses/${ courseID }/quizzes/${ quizID }/questions`
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
			let questions = response.data
			questions.map( ( question ) => {
				result.push( question )
			} )
			// handle pagination
			let parsed = parse( response.headers.link )
			if( parseInt( parsed.current.page ) >= parseInt( parsed.last.page ) ) {
				keepGoing = false
			} else {
				quizURL = parsed.next.url
			}
		}
		const doc = new PDFDocument
		let str = 'Questions for this Quiz\n\n'
		result.map( ( questionBlock ) => {
			let item = {}
			generateQuestionRow( doc, questionBlock )
			questionBlock.answers.map( ( answer ) => {
				createAnswerRow( doc, answer, questionBlock.question_type )
			} )
			generateSpace( doc )
		} )
		doc.pipe( res )
		doc.end()
	} catch ( err ) {
		console.log( err )
	}
} )

// on app creation, set the oauth2 parameters
// TODO state and scope
app.listen( port, () => {
	console.log( `listening on port ${ port }` )
	oauth2 = require('simple-oauth2').create( credentials )
	authorizationUri = oauth2.authorizationCode.authorizeURL({
		redirect_uri: 'https://questions2pdf.herokuapp.com/callback',
		scope: '',
		state: 'xyxyzzx'
	})
} )

app.use( '/css', express.static( path.join( __dirname, 'css') ) )