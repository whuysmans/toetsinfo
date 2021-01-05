const express = require('express')
const app = express()
let port = process.env.PORT || 3000
const axios = require('axios')
let school = process.env.SCHOOL || 'https://canvas.kdg.be'
let quizID = 0
let courseID = 0
let token = '' 
const fs = require('fs')
const path = require('path')
const parse = require('parse-link-header')
const puppeteer = require('puppeteer')
const wkhtmltopdf = require('wkhtmltopdf')
let state = ''
let html = '<html><head><meta http-equiv="Content-Type" content="text/html; charset=UTF-8"></head><body>'
const credentials = {
	client: {
		id: process.env.CLIENTID || '124000000000000046',
		secret: process.env.SECRET || 'fD0yA6FzZsiuFFKJRUJtLxOkh5986i5sFHXp4kyrDPVtAjPqVgTa8spe12vwuTx0'
	},
	auth: {
		tokenHost: process.env.SCHOOL || 'https://canvas.kdg.be',
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

const createShortAnswer = ( answers ) => {
	let tempHtml = '<p>'
	answers.forEach( ( answer ) => {
		tempHtml += `<span style="margin-right: 10px;">${ answer.text }</span>`
	} )
	tempHtml += '</p>'
	return tempHtml
}

const createMultipeDropdownOrFillTheBlanksAnswer = ( answers ) => {
	let blankIds = new Set()
	let tempHtml = '<p>'
	answers.forEach( ( answer ) => {
		blankIds.add( answer.blank_id )
	} )
	for ( let item of blankIds ) {
		const rowItems = answers.filter( ( answer ) => {
			return answer.blank_id === item
		} )
		tempHtml += `${ item }: `
		rowItems.forEach( ( rowItem ) => {
			tempHtml += rowItem.weight === 100 && rowItem.question_type === 'multiple_dropdowns_question' ? `<span style="margin-right: 10px;"> ${ rowItem.text }* </span>` :
			`<span style="margin-right: 10px;"> ${ rowItem.text } </span>`
		} )
		tempHtml += '<br />'
	}
	tempHtml += '</p>'
	return tempHtml
}

const createMatchingAnswer = ( answers ) => {
	let tempHtml = '<p>'
	answers.forEach( ( answer ) => {
		tempHtml += `<p><span style="margin-right: 5px;">${ answer.left }</span> -----  <span style="margin-left: 5px;">${ answer.right }</span></p>`
	} )
	tempHtml += '</p>'
	return tempHtml
}

const createMCOrMRAnswer = ( answers ) => {
	let tempHtml = '<p>'
	answers.forEach( ( answer ) => {
		tempHtml += answer.weight === 100 ? `${ answer.text }*<br />` :
			`${ answer.text }<br />`
	} )
	tempHtml += '</p>'
	return tempHtml
}

const createTrueFalseAnswer = ( answers ) => {
	let tempHtml = '<p>'
	answers.forEach( ( answer ) => {
		tempHtml += answer.weight === 100 ? `${ answer.text }*<br />`:
			`${ answer.text }<br />`
	} )
	tempHtml += '</p>'
	return tempHtml
}

const createNumericalAnswer = ( answers ) => {
	let tempHtml = '<p>'
	answers.forEach( ( answer ) => {
		tempHtml += answer.numerical_answer_type === 'range_answer' && answer.weight === 100 ?
			`between ${ answer.start } and ${ answer.end }` :
			answer.weight === 100 && answer.numerical_answer_type === 'exact_answer' ? `${ answer.exact } with margin ${ answer.margin }` : ''
	} )
	tempHtml += '</p>'
	return tempHtml
}

const createAnswerBlock = ( answers, type ) => {
	switch ( type ) {
		case 'multiple_dropdowns_question':
			return createMultipeDropdownOrFillTheBlanksAnswer( answers )
		case 'fill_in_multiple_blanks_question':
			return createMultipeDropdownOrFillTheBlanksAnswer( answers )
		case 'short_answer_question':
			return createShortAnswer( answers )
		case 'matching_question':
			return createMatchingAnswer( answers )
		case 'multiple_choice_question':
			return createMCOrMRAnswer( answers )
		case 'multiple_answers_question':
			return createMCOrMRAnswer( answers )
		case 'true_false_question':
			return createTrueFalseAnswer( answers )
		case 'numerical_question':
			return createNumericalAnswer( answers )
		case 'essay_question':
			return '<p>answer for essay question here</p>'
		default:
			return '<p></p>'
	}
}

const generateQuestionRow = ( question ) => {
	html += `<div style="padding: 5px">${ question.question_text }</div>`
}

const generateSpace = () => {
	html += '<hr><br /><br />'
}

const getRandomIdent = () => {
	return Math.random().toString(36).substring(4)
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
			console.log( response.headers )
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
		html += '<p>Questions for this Quiz</p>'
		result.map( ( questionBlock ) => {
			let item = {}
			generateQuestionRow( questionBlock )
			html += createAnswerBlock( questionBlock.answers, questionBlock.question_type )
			generateSpace()
		} )
		html += '</body></html>'
		const ts = new Date().getTime()
		const outFile = path.join( __dirname, `quiz-printout-${ ts }.pdf` )
		await createHTML( html, outFile, res )
		// res.download( outFile )
		html = '<html><head><meta http-equiv="Content-Type" content="text/html; charset=UTF-8"></head><body>'
	} catch ( err ) {
		console.log( err )
	}
} )

async function createHTML ( str, file, res ) {
	console.log( file )
	const browser = await puppeteer.launch()
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
	console.log( `click here: http://localhost:3000` )
	state = getRandomIdent()
	oauth2 = require('simple-oauth2').create( credentials )
	authorizationUri = oauth2.authorizationCode.authorizeURL({
		redirect_uri: 'http://localhost:3000/callback',
		//redirect_uri: `${ process.env.APPURL }/callback`,
		scope: `url:GET|/api/v1/courses/:course_id/quizzes/:quiz_id/questions`,
		state: state 
	})
} )

app.use( '/css', express.static( path.join( __dirname, 'css') ) )