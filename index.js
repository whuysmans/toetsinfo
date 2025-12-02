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
	const restAPIURL = `${ process.env.SCHOOL }/api/quiz/v1/courses/${ courseID }/quizzes/${ quizID }`
	const itemsAPIURL = `${ process.env.SCHOOL }/api/quiz/v1/courses/${ courseID }/quizzes/${ quizID }/items`
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
		let itemsResp = await axios({
			method: 'GET',
			url: itemsAPIURL,
			headers: {
				'Authorization': `Bearer ${ token }`
			}	
		})
		console.log ( itemsResp.data )
		const graphQLClient = new GraphQLClient( graphQLURL, {
			headers: {
				Authorization: `Bearer ${ token }`
			}
		} )
		const query = `
		query MyQuery( $id: ID! ) {
			course( id: $id ) {
				state
				modulesConnection {
					nodes {
						name
						published
						moduleItemsConnection {
							nodes {
								title
								published
								moduleItemUrl
							}
						}
					}
				}
				assignmentsConnection {
					nodes {
						_id
						name
						moduleItems {
							url
						}
					}
				}
			}
		  }
		`
		const variables = {
			id: parseInt( courseID )
		}
		try {
			const graphResp = await graphQLClient.request(
				query,
				variables
			)
			console.log( JSON.stringify( graphResp ) )
			const resultHTML = buildResultTable( restResp.data, graphResp, quizURL, quizID, itemsResp.data )
			res.send( resultHTML )
		} catch( graphqlErr ) {
			console.log( graphqlErr )
		}
		
		
	} catch( restErr ) {
		console.log( restErr )
	}

} )

const buildResultTable = ( restData, graphqlData, quizURL, quizID, itemsData ) => {
	let html = `<html>
					<head>
						<meta charset="utf-8">	
						<title>Check Toets Instellingen</title>
						<meta name="viewport" content="width=device-width, initial-scale=1">
						<link rel="stylesheet" href="https://unpkg.com/purecss@2.0.4/build/pure-min.css" integrity="sha384-LJy5cxQRSMIYu2ic+Tvw0Azob5Z3dQxRkR8LNGIq46AJEdfE9DtuBOCNtifRJeB7" crossorigin="anonymous">
						<link rel="stylesheet" href="css/styles.css">
					</head><body><div id="main">`
	const title = restData.title
	const linkTarget = quizURL.replace("quizzes", "assignments")
	const assignmentModule = findAssignmentModule( graphqlData, linkTarget )
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
		value: restData.quiz_settings.one_at_a_time_type,
		expectedValue: 'question',
		severity: 'orange' 
	}
	const timeLimit = {
		description: 'Tijdslimiet',
		value: restData.quiz_settings.has_time_limit,
		expectedValue: false,
		severity: 'red'
	}
	const published = {
		description: 'Toets is gepubliceerd',
		value: restData.published,
		expectedValue: true,
		severity: 'red'
	}
	const schoolYear = {
		description: 'SchoolYear vereist',
		value: restData.quiz_settings.require_student_access_code && restData.quiz_settings.student_access_code.substring(0,13) === 'do-not-share-',
		expectedValue: true,
		severity: 'red'
	}
	const showCorrect = {
		description: 'Verberg resultaten en juiste antwoorden',
		value: restData.quiz_settings.result_view_settings.result_view_restricted,
		expectedValue: true,
		severity: 'red'
	}
	const availableFrom = {
		description: 'Beschikbaar vanaf',
		value: new Date(restData.unlock_at).toLocaleString('nl-BE', {timeZone: 'CET'}),
		expectedValue: '',
		severity: 'orange'
	}
	const availableUntil = {
		description: 'Beschikbaar tot',
		value: new Date(restData.lock_at).toLocaleString('nl-BE', {timeZone: 'CET'}),
		expectedValue: '',
		severity: 'orange'
	}
	// const questionTypes = {
	// 	description: 'Aanwezige vraagtypes',
	// 	value: restData.question_types.join(', '),
	// 	expectedValue: [],
	// 	severity: 'orange'
	// }
	const allowedAttempts = {
		description: 'Aantal pogingen toegestaan',
		value: Object.keys(restData.quiz_settings.multiple_attempts).length === 0 || restData.quiz_settings.multiple_attempts.multiple_attempts_enabled === false,
		expectedValue: true,
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
		value: graphqlData.course.assignmentsConnection.nodes.filter((node) => node._id === quizID && node.moduleItems.length > 0).length > 0,
		expectedValue: false,
		severity: 'red'
	}
	// const questionCount = {
	// 	description: 'Aantal vragen',
	// 	value: restData.question_count,
	// 	expectedValue: 0,
	// 	severity: 'orange'
	// }
	const pointsPossible = {
		description: 'Aantal punten',
		value: restData.points_possible,
		expectedValue: 0,
		severity: 'orange'
	}
	// const shuffleAnswers = {
	// 	description: 'Volgorde van antwoorden wisselen',
	// 	value: restData.shuffle_answers,
	// 	expectedValue: needsShuffle(restData),
	// 	severity: 'red'
	// }
	const shuffleQuestions = {
		description: 'Vragen opnieuw rangschikken ingesteld',
		value: restData.quiz_settings.shuffle_questions,
		expectedValue: false,
		severity: 'red'
	}
	const hasAccessCode = {
		description: 'Toegangscode ingesteld',
		value: restData.quiz_settings.require_student_access_code,
		expectedValue: true,
		severity: 'red'
	}
	const ipFilter = {
		description: 'IP filter',
		value: restData.quiz_settings.filter_ip_address,
		expectedValue: false,
		severity: 'red'
	}
	const hasSprintInstructies = {
		description: 'Sprint instructie aanwezig',
		value: itemsData[0].entry_type === 'Stimulus' && itemsData[0].entry.title === 'Sprint',
		expectedValue: true,
		severity: 'orange'
	}
	const laatsteVraag = {
		description: 'Verwittiging laatste vraag aanwezig',
		value: itemsData[itemsData.length - 1].entry_type === 'Stimulus' && itemsData[itemsData.length - 1].entry.title === "Laatste vraag",
		expectedValue: true,
		severity: 'orange'
	}
	const linkInModule = {
		description: 'Link naar toets staat in module',
		value: assignmentModule && Object.keys(assignmentModule).length !== 0,
		expectedValue: true,
		severity: 'orange'
	}

	const linkInModuleOutput = () => {
		if ( linkInModule.value === true ) {
			return `<tr class="hover-container"><td>${ linkInModule.description }</td><td>${ linkInModule.value === false ? 'Nee' : 'Ja' }</td><td style="background-color:${ linkInModule.value === false ? 'orange' : 'orange' }">${ linkInModule.value === true ? 'OK' : 'NOK' }</td><td class="hover-target">&#9432;<aside class="hover-popup"><p>${ linkInModule.value === false ? 'We bevelen aan om in de link naar de toets in de examenmodule van de juiste periode te zetten.' : `De link naar de toets staat in deze module: ${ assignmentModule.name }`}</p></aside></td></tr>	
					<tr class="hover-container"><td>Module met toetslink gepubliceerd</td><td>${ assignmentModule.published === false ? 'Nee' : 'Ja' }</td><td style="background-color:${ assignmentModule.published === false ? 'red' : 'green' }">${ assignmentModule.published === true ? 'OK' : 'NOK' }</td><td class="hover-target">&#9432;<aside class="hover-popup"><p>De module met de toetslink moet gepubliceerd zijn voor het exmaen.</p></aside></td></tr>
					<tr class="hover-container"><td>Toetslink gepubliceerd</td><td>${ assignmentModule.moduleItemsConnection.nodes[0].published === false ? 'Nee' : 'Ja' }</td><td style="background-color:${ assignmentModule.moduleItemsConnection.nodes[0].published === false ? 'red' : 'green' }">${ assignmentModule.moduleItemsConnection.nodes[0].published === true ? 'OK' : 'NOK' }</td><td class="hover-target">&#9432;<aside class="hover-popup"><p>De toetslink moet gepubliceerd zijn.</p></aside></td></tr>
					`
		} else {
			return ''
		}

	}
	// const isMIT = () => {
	// 	return graphqlData.course.account.name.includes('Examencursussen')
	// }
	
	const tableBody = `<tbody>
		<tr class="hover-container"><td>${ coursePublished.description }</td><td>${ coursePublished.value === 'available' ? 'Ja' : 'Nee' }</td><td style="background-color:${ rowColor(coursePublished) }">${ coursePublished.value === coursePublished.expectedValue ? 'OK' : 'NOK' }</td><td class="hover-target">&#9432;<aside class="hover-popup"><p>Zorg dat je cursus tijdig gepubliceerd is.</p></aside></td></tr>
		<tr class="hover-container"><td>${ published.description }</td><td>${ published.value === true ? 'Ja' : 'Nee' }</td><td style="background-color:${ rowColor(published) }">${ published.value === published.expectedValue ? 'OK' : 'NOK' }</td><td class="hover-target">&#9432;<aside class="hover-popup"><p>Zorg dat je toets tijdig gepubliceerd is.</p></aside></td></tr>
		<tr class="hover-container"><td>${ pointsPossible.description }</td><td>${ pointsPossible.value }</td><td style="background-color:${ pointsPossible.value === 0 ? 'red' : 'orange' }">${ pointsPossible.value === 0 ? 'NOK' : 'OK?' }</td><td class="hover-target">&#9432;<aside class="hover-popup"><p>Controleer of het aantal punten correct is.</p></aside></td></tr>
		<tr class="hover-container"><td>${ shuffleQuestions.description }</td><td>${ shuffleQuestions.value === true ? 'Ja' : 'Nee' }</td><td style="background-color:${ shuffleQuestions.value === shuffleQuestions.expectedValue ? 'green' : 'orange' }">${ shuffleQuestions.value === shuffleQuestions.expectedValue ? 'OK' : 'OK?' }</td><td class="hover-target">&#9432;<aside class="hover-popup"><p>We raden af om de instelling 'Vragen opnieuw rangschikken' aan te vinken.</p></aside></td></tr>
		<tr class="hover-container"><td>${ timeLimit.description }</td><td>${ timeLimit.value !== false ? 'Ja' : 'Nee' }</td><td style="background-color:${ rowColor(timeLimit) }">${ timeLimit.value === timeLimit.expectedValue ? 'OK' : 'NOK' }</td><td class="hover-target">&#9432;<aside class="hover-popup"><p>Er wordt nooit met een tijdslimiet gewerkt. Deze vink je in de instellingen van de toets altijd uit.</p></aside></td></tr>
		<tr class="hover-container"><td>${ isInModule.description }</td><td>${ isInModule.value === false ? 'Nee' : 'Ja' }</td><td style="background-color:${ rowColor(isInModule) }">${ isInModule.value === isInModule.expectedValue ? 'OK' : 'NOK' }</td><td class="hover-target">&#9432;<aside class="hover-popup"><p>SchoolYear werkt niet met toetsen die als module-item aan een module werden toegevoegd. Zet in de module een link naar de toets.</p></aside></td></tr>
		${ linkInModuleOutput() }
		<tr class="hover-container"><td>${ allowedAttempts.description }</td><td>${ allowedAttempts.value === false ? 'meer dan 1' : 1 }</td><td style="background-color:${ rowColor(allowedAttempts) }">${ allowedAttempts.value === allowedAttempts.expectedValue ? 'OK' : 'NOK' }</td><td class="hover-target">&#9432;<aside class="hover-popup"><p>Voor een examen stellen we standaard maximum 1 poging in.</p></aside></td></tr>
		<tr class="hover-container"><td>${ showCorrect.description }</td><td>${ showCorrect.value === true ? 'Ja' : 'Nee' }</td><td style="background-color:${ rowColor(showCorrect) }">${ showCorrect.value === showCorrect.expectedValue ? 'OK' : 'NOK' }</td><td class="hover-target">&#9432;<aside class="hover-popup"><p>Bij examens toon je nooit meteen de juiste antwoorden. Deze maak je pas zichtbaar nadat de punten officieel gecommuniceerd zijn.</p></aside></td></tr>
		<tr class="hover-container"><td>${ oneQuestionAtATime.description }</td><td>${ oneQuestionAtATime.value === 'question' ? 'Ja' : 'Nee' }</td><td style="background-color:${ rowColor(oneQuestionAtATime) }">${ oneQuestionAtATime.value === oneQuestionAtATime.expectedValue ? 'OK' : 'OK?' }</td><td class="hover-target">&#9432;<aside class="hover-popup"><p>Heb je ervoor gekozen om je vragen een voor een aan te bieden en is dit in lijn met eventuele opleidingsspecifieke afspraken?Op <a href="https://canvas.kdg.be/courses/24981/pages/waar-vind-ik-de-exameninstructies-en-handleidingen-voor-mijn-opleiding" target="_blank">deze pagina</a> kan je eventuele opleidingsspecifieke afspraken nog eens checken.</p></aside></td></tr>
		<tr class="hover-container"><td>${ schoolYear.description }</td><td>${ schoolYear.value === true ? 'Ja' : 'Nee' }</td><td style="background-color:${ rowColor(schoolYear) }">${ schoolYear.value === schoolYear.expectedValue ? 'OK' : 'NOK' }</td><td class="hover-target">&#9432;<aside class="hover-popup"><p>Bij gesloten boek examens moet Schoolyear ingeschakeld zijn. Hoe je dat doet, vind je op <a href="https://canvas.kdg.be/courses/24981/pages/digitaal-examen-via-klassieke-canvastoets-met-respondus-lockdown-browser-en-slash-of-monitor" target="_blank">deze pagina</a>.</p></aside></td></tr>
		<tr class="hover-container"><td>${ availableFrom.description }</td><td>${ availableFrom.value }</td><td style="background-color:${ dateRowColor(availableFrom) }">${ availableFrom.value === '' ? 'NOK' : 'OK?' }</td><td class="hover-target">&#9432;<aside class="hover-popup"><p>Stel de correcte begindatum en -tijd in.</p></aside></td></tr>
		<tr class="hover-container"><td>${ availableUntil.description }</td><td>${ availableUntil.value }</td><td style="background-color:${ dateRowColor(availableUntil) }">${ availableUntil.value === '' ? 'NOK' : 'OK?' }</td><td class="hover-target">&#9432;<aside class="hover-popup"><p>Stel de correcte einddatum en -tijd in. Controleer zeker of je de beschikbaarheid 1 uur langer dan de duurtijd van het examen hebt ingesteld.</p></aside></td></tr>
		<tr class="hover-container"><td>${ hasAccessCode.description }</td><td>${ hasAccessCode.value === true ? 'Ja' : 'Nee' }</td><td style="background-color:${ rowColor(hasAccessCode) }">${ hasAccessCode.value === hasAccessCode.expectedValue ? 'OK' : 'NOK' }</td><td class="hover-target">&#9432;<aside class="hover-popup"><p>Je moet voor je examen altijd een toegangscode instellen via de SchoolYear widget. Deze code wordt dan automatisch in de toetsinstellingen ingevuld en moet je niet meer wijzigen. Als je een openboek examen hebt - dus zonder SchoolYear - kan je de toegangscode rechtsreeks in de instellingen van de toets ingeven.</p></aside></td></tr>
		<tr class="hover-container"><td>${ ipFilter.description }</td><td>${ ipFilter.value === false ? 'Nee' : 'Ja' }</td><td style="background-color:${ ipFilter.value === false ? 'green' : 'red' }">${ ipFilter.value === false ? 'OK' : 'NOK' }</td><td class="hover-target">&#9432;<aside class="hover-popup"><p>Deze instelling moet zeker uitgevinkt staan!</p></aside></td></tr>
		<tr class="hover-container"><td>${ hasSprintInstructies.description }</td><td>${ hasSprintInstructies.value === false ? 'Nee' : 'Ja' }</td><td style="background-color:${ hasSprintInstructies.value === false ? 'orange' : 'green' }">${ hasSprintInstructies.value === true ? 'OK' : 'NOK' }</td><td class="hover-target">&#9432;<aside class="hover-popup"><p>De toets moet als eerste vraag een tekstvraag bevatten met een link naar de Sprintomgeving voor studenten met een bijzonder statuut.</p></aside></td></tr>
		<tr class="hover-container"><td>${ laatsteVraag.description }</td><td>${ laatsteVraag.value === false ? 'Nee' : 'Ja' }</td><td style="background-color:${ laatsteVraag.value === false ? 'orange' : 'green' }">${ laatsteVraag.value === true ? 'OK' : 'NOK' }</td><td class="hover-target">&#9432;<aside class="hover-popup"><p>De toets moet als laatste vraag een tekstvraag bevatten met de melding dat dit de laatste vraag is.</p></aside></td></tr>
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
	if ( obj.value === '' ) {
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

const findAssignmentModule = ( graphqlData, url ) => {
	return graphqlData.course.modulesConnection.nodes.find((module) => module.moduleItemsConnection.nodes.find((item) => item.moduleItemUrl === url))
}

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