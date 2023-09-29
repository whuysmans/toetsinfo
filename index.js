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
	const quizURL = req.query.quiz.split('?')[0]
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
				account {
					name
				}
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
	const tableHeaders = `<table class="pure-table pure-table-horizontal">${ tableLegend }<thead><tr><th>Naam</th><th>Setting</th><th>OK?</th><th></th></tr></thead>`
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
		description: 'Toets is gepubliceerd',
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
		value: restData.all_dates[0].lock_at ? new Date(restData.all_dates[0].lock_at).toLocaleString('nl-BE', {timeZone: 'CET'}) : '1/1/1970 01:00:00' ,
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
	const pointsPossible = {
		description: 'Aantal punten',
		value: restData.points_possible,
		expectedValue: 0,
		severity: 'orange'
	}
	const shuffleAnswers = {
		description: 'Volgorde van antwoorden wisselen',
		value: restData.shuffle_answers,
		expectedValue: needsShuffle(restData),
		severity: 'red'
	}
	const hasAccessCode = {
		description: 'Toegangscode ingesteld',
		value: restData.has_access_code,
		expectedValue: false,
		severity: 'red'
	}
	const ipFilter = {
		description: 'IP filter ingesteld',
		value: restData.ip_filter,
		expectedValue: null,
		severity: 'red'
	}
	const isMIT = () => {
		return graphqlData.course.account.name.includes('Examencursussen')
	}
	
	const tableBody = `<tbody>
		<tr class="hover-container"><td>${ coursePublished.description }</td><td>${ coursePublished.value === 'available' ? 'Ja' : 'Nee' }</td><td style="background-color:${ rowColor(coursePublished) }">${ coursePublished.value === coursePublished.expectedValue ? 'OK' : 'NOK' }</td><td class="hover-target">&#9432;<aside class="hover-popup"><p>Zorg dat je cursus tijdig gepubliceerd is.</p></aside></td></tr>
		<tr class="hover-container"><td>${ published.description }</td><td>${ published.value === true ? 'Ja' : 'Nee' }</td><td style="background-color:${ rowColor(published) }">${ published.value === published.expectedValue ? 'OK' : 'NOK' }</td><td class="hover-target">&#9432;<aside class="hover-popup"><p>Zorg dat je toets tijdig gepubliceerd is.</p></aside></td></tr>
		<tr class="hover-container"><td>${ pointsPossible.description }</td><td>${ pointsPossible.value }</td><td style="background-color:${ pointsPossible.value === 0 ? 'red' : 'orange' }">${ pointsPossible.value === 0 ? 'NOK' : 'OK?' }</td><td class="hover-target">&#9432;<aside class="hover-popup"><p>Controleer of het aantal punten correct is.</p></aside></td></tr>
		<tr class="hover-container"><td>${ shuffleAnswers.description }</td><td>${ shuffleAnswers.value === true ? 'Ja' : 'Nee' }</td><td style="background-color:${ rowColor(shuffleAnswers) }">${ shuffleAnswers.value === shuffleAnswers.expectedValue ? 'OK' : 'NOK' }</td><td class="hover-target">&#9432;<aside class="hover-popup"><p>Als je toets meerkeuzevragen vragen bevat, moet je de instelling 'Volgorde van antwoorde wisselen' aanvinken.</p></aside></td></tr>
		<tr class="hover-container"><td>${ timeLimit.description }</td><td>${ timeLimit.value !== null ? 'Ja' : 'Nee' }</td><td style="background-color:${ rowColor(timeLimit) }">${ timeLimit.value === timeLimit.expectedValue ? 'OK' : 'NOK' }</td><td class="hover-target">&#9432;<aside class="hover-popup"><p>Er wordt nooit met een tijdslimiet gewerkt. Deze vink je in de instellingen van de toets altijd uit.</p></aside></td></tr>
		<tr class="hover-container"><td>${ allowedAttempts.description }</td><td>${ allowedAttempts.value === -1 ? 'onbeperkt' : allowedAttempts.value }</td><td style="background-color:${ rowColor(allowedAttempts) }">${ allowedAttempts.value === allowedAttempts.expectedValue ? 'OK' : 'NOK' }</td><td class="hover-target">&#9432;<aside class="hover-popup"><p>Voor een examen stellen we standaard maximum 1 poging in. Pas dit in de instellingen van je toets aan.</p></aside></td></tr>
		<tr class="hover-container"><td>${ showCorrect.description }</td><td>${ showCorrect.value === true ? 'Ja' : 'Nee' }</td><td style="background-color:${ rowColor(showCorrect) }">${ showCorrect.value === showCorrect.expectedValue ? 'OK' : 'NOK' }</td><td class="hover-target">&#9432;<aside class="hover-popup"><p>Bij examens toon je nooit meteen de juiste antwoorden. Deze maak je pas zichtbaar nadat de punten officieel gecommuniceerd zijn.</p></aside></td></tr>
		<tr class="hover-container"><td>${ oneQuestionAtATime.description }</td><td>${ oneQuestionAtATime.value === true ? 'Ja' : 'Nee' }</td><td style="background-color:${ rowColor(oneQuestionAtATime) }">${ oneQuestionAtATime.value === oneQuestionAtATime.expectedValue ? 'OK' : 'OK?' }</td><td class="hover-target">&#9432;<aside class="hover-popup"><p>Heb je ervoor gekozen om je vragen een voor een aan te bieden en is dit in lijn met eventuele opleidingsspecifieke afspraken?</p></aside></td></tr>
		<tr class="hover-container"><td>${ lockdownBrowser.description }</td><td>${ lockdownBrowser.value === true ? 'Ja' : 'Nee' }</td><td style="background-color:${ rowColor(lockdownBrowser) }">${ lockdownBrowser.value === lockdownBrowser.expectedValue ? 'OK' : 'NOK' }</td><td class="hover-target">&#9432;<aside class="hover-popup"><p>Schakel de lockdown browser in. Hoe je dat doet, vind je op <a href="https://canvas.kdg.be/courses/24981/pages/digitaal-examen-via-klassieke-canvastoets-met-respondus-lockdown-browser-en-slash-of-monitor">deze pagina</a>.</p></aside></td></tr>
		<tr class="hover-container"><td>${ monitor.description }</td><td>${ monitor.value === true ? 'Ja' : 'Nee' }</td><td style="background-color:${ rowColor(monitor) }">${ monitor.value === monitor.expectedValue ? 'OK' : 'NOK' }</td><td class="hover-target">&#9432;<aside class="hover-popup"><p>Enkel als je een bericht hebt ontvangen dat je een student hebt die het exmen van thuis uit mag afleggen, kan je de monitor inschakelen. 
		Heb je zo'n bericht gekregen? Prima, laat de monitor aan staan. 
		Heb je geen bericht ontvangen? Ga naar de instellingen van de lockdown browser en schakel deze weer uit. <a href="https://canvas.kdg.be/courses/24981/pages/digitaal-examen-via-klassieke-canvastoets-met-respondus-lockdown-browser-en-slash-of-monitor">Meer info</a>.</p></aside></td></tr>
		<tr class="hover-container"><td>${ questionTypes.description }</td><td>${ questionTypes.value }</td><td style="background-color:orange";>OK?</td><td class="hover-target">&#9432;<aside class="hover-popup"><p>${ questionTypes.value !== '' ? 'Controleer of al soorten examenvragen die je in je examen wil opnemen hier vermeld staan.' : 'Er zitten nog geen vragen in de toets. Voeg deze zeker nog toe! Als je met toetsbanken werkt: controleer of de linken naar de banken goed gelegd zijn.' }</p></aside></td></tr>
		<tr class="hover-container"><td>${ questionCount.description }</td><td>${ questionCount.value }</td><td style="background-color:orange">OK?</td><td class="hover-target">&#9432;<aside class="hover-popup"><p>Controleer of hier het juiste aantal vragen is weergegeven.</p></aside></td></tr>
		<tr class="hover-container"><td>${ availableUntil.description }</td><td>${ availableUntil.value }</td><td style="background-color:${ dateRowColor(availableUntil) }">${ availableUntil.value === availableUntil.expectedValue ? 'NOK' : 'OK?' }</td><td class="hover-target">&#9432;<aside class="hover-popup"><p>Stel de correcte einddatum en -tijd in. Controleer zeker of je de beschikbaarheid 1 uur langer dan de duurtijd van het examen hebt ingesteld.</p></aside></td></tr>
		<tr class="hover-container"><td>${ hasAccessCode.description }</td><td>${ hasAccessCode.value === true ? 'Ja' : 'Nee' }</td><td style="background-color:${ rowColor(hasAccessCode) }">${ hasAccessCode.value === hasAccessCode.expectedValue ? 'OK' : 'NOK' }</td><td class="hover-target">&#9432;<aside class="hover-popup"><p>Stel voor je examen nooit een toegangscode in.</p></aside></td></tr>
		<tr class="hover-container"><td>${ ipFilter.description }</td><td>${ ipFilter.value === null ? 'Nee' : 'Ja' }</td><td style="background-color:${ ipFilter.value === null ? 'green' : 'red' }">${ ipFilter.value === null ? 'OK' : 'NOK' }</td><td class="hover-target">&#9432;<aside class="hover-popup"><p>Deze instelling moet zeker uitgevinkt staan!</p></aside></td></tr>
		${ !isMIT() ? '' : `<tr class="hover-container"><td>${ isInModule.description }</td><td>${ isInModule.value }</td><td style="background-color:${ isInModule.value === 'Nee' ? 'red' : 'orange' }">${ isInModule.value === 'Nee' ? 'NOK' : 'OK?' }</td><td class="hover-target">&#9432;<aside class="hover-popup"><p>Controleer of dit inderdaad de module is waarin de toets moet zitten. </p></aside></td></tr` }
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

const needsShuffle = (data) => {
	if ( data.question_types && data.question_types.length > 0 ) {
		return data.question_types.includes('multiple_choice_question') ||
			data.question_types.includes('multiple_answers_question')
	} else {
		return false
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