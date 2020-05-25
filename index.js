const express = require('express')
const app = express()
const port = 3000
const axios = require('axios')
const baseURL = 'https://canvas.kdg.be/api/v1/' 
let quizID = 0
let courseID = 0
let token = '' 
const PDFDocument = require('pdfkit')
const fs = require('fs')
const path = require('path')
const parse = require('parse-link-header')

app.get('/', ( req, res ) => {
	res.sendFile( path.join( __dirname + '/index.html' ) )
} )

app.get('/test', async ( req, res ) => {
	quizID = req.query.assignment
	courseID = req.query.course
	token = `Bearer ${ req.query.token }`
	let quizURL = `${ baseURL }courses/${ courseID }/quizzes/${ quizID }/questions`
	let result = []
	try {
		let keepGoing = true
		while ( keepGoing ) {
			let response = await axios({
				method: 'GET',
				url: quizURL,
				headers: {
					'Authorization': token
				}
			})
			let questions = response.data
			questions.map( ( question ) => {
				result.push( question )
			} )
			let parsed = parse( response.headers.link )
			console.log( parsed )
			if( parseInt( parsed.current.page ) >= parseInt( parsed.last.page ) ) {
				keepGoing = false
			} else {
				quizURL = parsed.next.url
			}
		}
		console.log( result )
		const doc = new PDFDocument
		let str = 'Questions for this Quiz\n'
		result.map( ( questionBlock ) => {
			let item = {}
			str += `${ questionBlock.question_text }\n\n`
			questionBlock.answers.map( ( answer ) => {
				if ( questionBlock.question_type === 'fill_in_multiple_blanks_question' ) {
					str += `${ answer.text } (${ answer.blank_id })\n`
				} else {
					str += `${ answer.text }\n`
				}
			} )
			str += `\n\n`
		} )
		doc.text( str )
		doc.pipe( res )
		doc.end()
	} catch ( err ) {
		console.log( err )
	}
} )

app.listen( port, () => console.log( `listening on port ${ port }` ) )