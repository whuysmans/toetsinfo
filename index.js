const express = require('express')
const app = express()
let port = process.env.PORT || 3000
const axios = require('axios')
const school = process.env.SCHOOL
let token = '' 
const path = require('path')
const parse = require('parse-link-header')
const dotenv = require('dotenv')
const { GraphQLClient } = require('graphql-request')
const { request } = require('graphql-request')
dotenv.config()
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


// on form submit, launch the Canvas API request
app.get('/check', [
], async ( req, res ) => {
	const errors = validationResult( req )
	if ( ! errors.isEmpty() ) {
		return res.status( 422 ).json( { errors: errors.array() } )
	}
	console.log(req.query.quiz)
	const quizURL = req.query.quiz
	const splittedURLArray = quizURL.split('/')
	const courseID = splittedURLArray[4]
	const quizID = splittedURLArray[6]
	const restAPIURL = `${ process.env.SCHOOL }/api/v1/courses/${ courseID }/quizzes/${ quizID }`
	const graphQLURL = `${ process.env.SCHOOL }/api/graphql`
	console.log(restAPIURL)

	try {
		let restResp = await axios({
			method: 'GET',
			url: restAPIURL,
			headers: {
				'Authorization': `Bearer ${ token }`
			}
		})
		console.log( restResp.data )
		const graphQLClient = new GraphQLClient( graphQLURL, {
			headers: {
				Authorization: `Bearer ${ token }`
			}
		} )
		const query = `
		query MyQuery( $id: ID! ) {
			assignment(id: $id) {
			  name
			  pointsPossible
			  postManually
			  state
			  course {
				name
				state
			  }
			  quiz {
				modules {
					name
				}
			  }
			}
		  }
		`
		const variables = {
			id: parseInt( restResp.data.assignment_id )
		}
		try {
			const graphResp = await graphQLClient.request(
				query,
				variables
			)
			console.log( JSON.stringify( graphResp ) )
			const resultHTML = buildResultTable( restResp.data, graphResp.assignment )
			res.send( resultHTML )
		} catch( graphqlErr ) {
			console.log( graphqlErr )
		}
		
		
	} catch( restErr ) {
		console.log( restErr )
	}

} )

const buildResultTable = ( restData, graphqlData ) => {
	let html = `<html>
					<head>
						<meta charset="utf-8">	
						<title>Check Toets Instellingen</title>
						<meta name="viewport" content="width=device-width, initial-scale=1">
						<link rel="stylesheet" href="https://unpkg.com/purecss@2.0.4/build/pure-min.css" integrity="sha384-LJy5cxQRSMIYu2ic+Tvw0Azob5Z3dQxRkR8LNGIq46AJEdfE9DtuBOCNtifRJeB7" crossorigin="anonymous">
						<link rel="stylesheet" href="css/styles.css">
					</head><body><div id="main">`
	const title = restData.title
	const linkTarget = restData.html_url
	const tableTitle = `<p>Check instellingen voor:</p><h2><a href="${ linkTarget }">${ title }</a></h2>`
	const tableLegend = `<caption>
							<ul class="legend">
								<li><span class="green"></span>Alles OK.</li>
								<li><span class="orange"></span>Correct of niet correct, zeker te controleren.</li>
								<li><span class="red"></span>Niet correct, opnieuw instellen.</li>
							</ul>
						</caption>`
	const tableHeaders = `<table class="pure-table pure-table-horizontal">${ tableLegend }<thead><tr><th>Naam</th><th>Setting</th><th>OK?</th></tr></thead>`
	const oneQuestionAtATime = {
		description: 'Een vraag per keer',
		value: restData.one_question_at_a_time,
		expectedValue: true,
		severity: 'orange' 
	}
	const timeLimit = {
		description: 'Tijdslimiet',
		value: restData.time_limit,
		expectedValue: null,
		severity: 'red'
	}
	const published = {
		description: 'Gepubliceerd',
		value: restData.published,
		expectedValue: true,
		severity: 'red'
	}
	const lockdownBrowser = {
		description: 'Lockdown Browser vereist',
		value: restData.require_lockdown_browser,
		expectedValue: true,
		severity: 'red'
	}
	const monitor = {
		description: 'Lockdown Browser + Monitor vereist',
		value: restData.require_lockdown_browser_monitor,
		expectedValue: false,
		severity: 'red'
	}
	const showCorrect = {
		description: 'Toon onmiddellijk juiste antwoorden',
		value: restData.show_correct_answers,
		expectedValue: false,
		severity: 'red'
	}
	const availableUntil = {
		description: 'Beschikbaar tot',
		value: new Date(restData.all_dates[0].lock_at).toLocaleString('nl-BE', {timeZone: 'CET'}),
		expectedValue: '1/1/1970 01:00:00',
		severity: 'orange'
	}
	const questionTypes = {
		description: 'Aanwezige vraagtypes',
		value: restData.question_types.join(', '),
		expectedValue: [],
		severity: 'orange'
	}
	const allowedAttempts = {
		description: 'Aantal pogingen toegestaan',
		value: restData.allowed_attempts,
		expectedValue: 1,
		severity: 'red'
	}
	const coursePublished = {
		description: 'Cursus is gepubliceerd',
		value: graphqlData.course.state,
		expectedValue: 'available',
		severity: 'red'
	}
	const isInModule = {
		description: 'Toets zit in module',
		value: graphqlData.quiz.modules.length > 0 ? graphqlData.quiz.modules.map((module) =>  module.name).join(', ') : 'Nee',
		expectedValue: '',
		severity: 'red'
	}
	const questionCount = {
		description: 'Aantal vragen',
		value: restData.question_count,
		expectedValue: 0,
		severity: 'orange'
	}
	const tableBody = `<tbody>
		<tr><td>${ published.description }</td><td>${ published.value === true ? 'Ja' : 'Nee' }</td><td style="background-color:${ rowColor(published) }">${ published.value === published.expectedValue ? 'OK' : 'NOK' }</td></tr>
		<tr><td>${ timeLimit.description }</td><td>${ timeLimit.value !== null ? 'Ja' : 'Nee' }</td><td style="background-color:${ rowColor(timeLimit) }">${ timeLimit.value === timeLimit.expectedValue ? 'OK' : 'NOK' }</td></tr>
		<tr><td>${ oneQuestionAtATime.description }</td><td>${ oneQuestionAtATime.value === true ? 'Ja' : 'Nee' }</td><td style="background-color:${ rowColor(oneQuestionAtATime) }">${ oneQuestionAtATime.value === oneQuestionAtATime.expectedValue ? 'OK' : 'OK?' }</td></tr>
		<tr><td>${ lockdownBrowser.description }</td><td>${ lockdownBrowser.value === true ? 'Ja' : 'Nee' }</td><td style="background-color:${ rowColor(lockdownBrowser) }">${ lockdownBrowser.value === lockdownBrowser.expectedValue ? 'OK' : 'NOK' }</td></tr>
		<tr><td>${ monitor.description }</td><td>${ monitor.value === true ? 'Ja' : 'Nee' }</td><td style="background-color:${ rowColor(monitor) }">${ monitor.value === monitor.expectedValue ? 'OK' : 'NOK' }</td></tr>
		<tr><td>${ showCorrect.description }</td><td>${ showCorrect.value === true ? 'Ja' : 'Nee' }</td><td style="background-color:${ rowColor(showCorrect) }">${ showCorrect.value === showCorrect.expectedValue ? 'OK' : 'NOK' }</td></tr>
		<tr><td>${ availableUntil.description }</td><td>${ availableUntil.value }</td><td style="background-color:${ dateRowColor(availableUntil) }">${ availableUntil.value === availableUntil.expectedValue ? 'NOK' : 'OK?' }</td></tr>
		<tr><td>${ questionTypes.description }</td><td>${ questionTypes.value }</td><td style="background-color:orange";>OK?</td></tr>
		<tr><td>${ allowedAttempts.description }</td><td>${ allowedAttempts.value === -1 ? 'onbeperkt' : allowedAttempts.value }</td><td style="background-color:${ rowColor(allowedAttempts) }">${ allowedAttempts.value === allowedAttempts.expectedValue ? 'OK' : 'NOK' }</td></tr>
		<tr><td>${ coursePublished.description }</td><td>${ coursePublished.value === 'available' ? 'Ja' : 'Nee' }</td><td style="background-color:${ rowColor(coursePublished) }">${ coursePublished.value === coursePublished.expectedValue ? 'OK' : 'NOK' }</td></tr>
		<tr><td>${ isInModule.description }</td><td>${ isInModule.value }</td><td style="background-color:${ isInModule.value === 'Nee' ? 'red' : 'orange' }">${ isInModule.value === 'Nee' ? 'NOK' : 'OK?' }</td></tr>
		<tr><td>${ questionCount.description }</td><td>${ questionCount.value }</td><td style="background-color:${ questionCount.value > 0 ? 'green' : 'red' }">${ questionCount.value > 0 ? 'OK' : 'OK?' }</td></tr>
		</tbody>
	`
	const tableEnd = `</table>
						<div class="pure-controls">
							<button id="logoutButton" class="pure-button button-error" type="submit">Uitloggen</button>
							<button id="returnButton" type="submit" class="pure-button pure-button-primary">Check andere toets</button>
						</div>
						<script>
							window.onload = () => {
								const logoutBtn = document.querySelector('#logoutButton')
								logoutBtn.addEventListener( 'click', async ( event ) => {
									event.preventDefault()
									window.location.href = '/logout'
								} )
								const returnBtn = document.querySelector('#returnButton')
								returnBtn.addEventListener( 'click', async ( event ) => {
									event.preventDefault()
									window.location.href = '/start'
								} )
							}
						</script>	
					</div></body></html>`
	html += tableTitle + tableHeaders + tableBody + tableEnd
	return html
}

const getRandomIdent = () => {
	return Math.random().toString(36).substring(4)
}

const dateRowColor = (obj) => {
	if ( obj.value === '1/1/1970 01:00:00' ) {
		return 'red'
	}
	else {
		return obj.severity
	}
}


const rowColor = (obj) => {
	if ( obj.expectedValue === obj.value ) {
		return 'green'
	} else {
		return obj.severity
	}
} 

app.get( '/logout', async ( req, res ) => {
	let logoutURL = `${ process.env.SCHOOL }/login/oauth2/token`
	console.log( logoutURL )
	await axios.delete( logoutURL, { headers: { 'Authorization': `Bearer ${ token }`	} } )
	token = ''
	res.redirect('/')
} )

// on app creation, set the oauth2 parameters
// TODO state and scope
app.listen( port, () => {
	state = getRandomIdent()
	console.log(process.env.SCHOOL)
	oauth2 = require('simple-oauth2').create( credentials )
	authorizationUri = oauth2.authorizationCode.authorizeURL({
		// redirect_uri: 'http://localhost:3000/callback',
		redirect_uri: `${ process.env.APPURL }/callback`,
		// scope: `url:GET|/api/v1/courses/:course_id/quizzes/:quiz_id/submissions url:GET|/api/v1/users/:id`,
		state: state 
	})
} )

app.use( '/css', express.static( path.join( __dirname, 'css') ) )