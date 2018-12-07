/**
 * audioMotion.js
 * A real-time graphic spectrum analyzer and audio player using Web Audio and Canvas APIs
 *
 * https://github.com/hvianna/audioMotion.js
 *
 * Copyright (C) 2018 Henrique Vianna <hvianna@gmail.com>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

var _VERSION = '18.12';


/**
 * Global variables
 */
var playlist, playlistPos,
	// our playlist and index to its current position
	elFFTsize, elRangeMin, elRangeMax, elSmoothing,	elGradient, elShowScale, elLogScale, elHighSens, elShowPeaks, elPlaylists,
	// HTML elements from the UI
	cfgSource, cfgShowScale, cfgLogScale, cfgShowPeaks,
	// flags for things we need to check too often (inside the draw function)
	bufferLength, dataArray,
	// analyzer FFT data
	peaks, hold, accel,
	// peak value, hold time and fall acceleration (arrays)
	posx, iMin, iMax, deltaX, bandWidth,
	// frequency range and scale related variables
	audioCtx, analyser, audioElement, sourcePlayer, sourceMic,
	// Web Audio API related variables
	canvas, canvasCtx, gradients, pixelRatio;
	// canvas stuff

/**
 * Default options
 */
var defaults = {
	fftSize		: 4,		// index of #fft_size select element
	freqMin		: 0,		// index of #freq_min select element
	freqMax		: 4,		// index of #freq_max select element
	smoothing	: 0.5,		// 0 to 0.9 - smoothing time constant
	gradient	: 0,		// index of #gradient select element
	showScale 	: true,		// true to show x-axis scale
	logScale	: true,		// true to use logarithmic scale
	highSens	: false,	// true for high sensitivity
	showPeaks 	: true		// true to show peaks
}


/**
 * Display the canvas in full-screen mode
 */
function fullscreen() {
	if ( canvas.requestFullscreen )
		canvas.requestFullscreen();
	else if ( canvas.webkitRequestFullscreen )
		canvas.webkitRequestFullscreen();
	else if ( canvas.mozRequestFullScreen )
		canvas.mozRequestFullScreen();
	else if ( canvas.msRequestFullscreen )
		canvas.msRequestFullscreen();
}

/**
 * Adjust the analyser's sensitivity
 */
function setSensitivity() {
	if ( elHighSens.dataset.active == '1' ) {
		analyser.minDecibels = -100; // WebAudio API defaults
		analyser.maxDecibels = -30;
	}
	else {
		analyser.minDecibels = -85;
		analyser.maxDecibels = -25;
	}
	docCookies.setItem( 'highSens', elHighSens.dataset.active, Infinity );
}

/**
 * Set the smoothing time constant
 */
function setSmoothing() {
	analyser.smoothingTimeConstant = elSmoothing.value;
	consoleLog( 'smoothingTimeConstant is ' + analyser.smoothingTimeConstant );
	docCookies.setItem( 'smoothing', analyser.smoothingTimeConstant, Infinity );
}

/**
 * Set the size of the FFT performed by the analyser node
 */
function setFFTsize() {

	analyser.fftSize = elFFTsize.value;

	// update all variables that depend on the FFT size
	bufferLength = analyser.frequencyBinCount;
	dataArray = new Uint8Array( bufferLength );

	consoleLog( 'FFT size is ' + analyser.fftSize + ' samples' );
	docCookies.setItem( 'fftSize', elFFTsize.selectedIndex, Infinity );

	preCalcPosX();
}

/**
 * Save desired frequency range
 */
function setFreqRange() {
	docCookies.setItem( 'freqMin', elRangeMin.selectedIndex, Infinity );
	docCookies.setItem( 'freqMax', elRangeMax.selectedIndex, Infinity );
	preCalcPosX();
}

/**
 * Save scale preferences
 */
function setScale() {
	docCookies.setItem( 'showScale', elShowScale.dataset.active, Infinity );
	docCookies.setItem( 'logScale', elLogScale.dataset.active, Infinity );
	preCalcPosX();
}

/**
 * Save show peaks preference
 */
function setShowPeaks() {
	cfgShowPeaks = ( elShowPeaks.dataset.active == '1' );
	docCookies.setItem( 'showPeaks', elShowPeaks.dataset.active, Infinity );
}

/**
 * Pre-calculate the actual X-coordinate on screen for each frequency
 */
function preCalcPosX() {

	var freq,
		lastPos = -1,
		fMin = elRangeMin.value,
		fMax = elRangeMax.value;

	cfgShowScale = ( elShowScale.dataset.active == '1' );
	cfgLogScale = ( elLogScale.dataset.active == '1' );

	// indexes corresponding to the frequency range we want to visualize in the data array returned by the FFT
	iMin = Math.floor( fMin * analyser.fftSize / audioCtx.sampleRate );
	iMax = Math.round( fMax * analyser.fftSize / audioCtx.sampleRate );

	// clear / initialize peak data
	peaks = new Array();
	hold = new Array();
	accel = new Array();

	if ( cfgLogScale ) {
		// if using the log scale, we divide the canvas space by log(fmax) - log(fmin)
		deltaX = Math.log10( fMin );
		bandWidth = canvas.width / ( Math.log10( fMax ) - deltaX );
	}
	else {
		// in the linear scale, we simply divide it by the number of frequencies we have to display
		deltaX = iMin;
		bandWidth = canvas.width / ( iMax - iMin + 1 );
	}

	for ( var i = iMin; i <= iMax; i++ ) {
		if ( cfgLogScale ) {
			freq = i * audioCtx.sampleRate / analyser.fftSize; // find which frequency is represented in this bin
			posx[ i ] = Math.round( bandWidth * ( Math.log10( freq ) - deltaX ) ); // avoid fractionary pixel values
		}
		else
			posx[ i ] = Math.round( bandWidth * ( i - deltaX ) );

		// ignore overlapping positions for improved performance
		if ( posx[ i ] == lastPos )
			posx[ i ] = -1;
		else
			lastPos = posx[ i ];
	}

	drawScale();
}

/**
 * Draws the x-axis scale
 */
function drawScale() {

	var bands, freq, incr, label, posX;

	canvasCtx.font = ( 10 * pixelRatio ) + 'px sans-serif';
	canvasCtx.fillStyle = '#000';
	canvasCtx.fillRect( 0, canvas.height - 20 * pixelRatio, canvas.width, 20 * pixelRatio );

	if ( ! cfgShowScale )
		return;

	canvasCtx.fillStyle = '#fff';

	bands = [0, 20, 30, 40, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 15000, 20000, 25000];
	freq = 0;

	if ( cfgLogScale )
		incr = 10;
	else
		incr = 500;

	while ( freq <= bands[ bands.length - 1 ] ) {

		if ( cfgLogScale ) {
			posX = bandWidth * ( Math.log10( freq ) - deltaX );
			if ( freq == 100 || freq == 1000 )
				incr *= 10;
		}
		else {
			posX = bandWidth * ( freq * analyser.fftSize / audioCtx.sampleRate - deltaX );
			if ( freq == 1000 )
				incr = 1000;
		}

		if ( bands.indexOf( freq ) != -1 ) {
			if ( freq >= 1000 )
				label = freq / 1000 + 'k';
			else
				label = String( freq );
			canvasCtx.fillText( label, posX > 10 * pixelRatio ? posX - label.length * 2.75 * pixelRatio : posX, canvas.height - 5 * pixelRatio );
		}
		else
			canvasCtx.fillRect( posX, canvas.height - 5 * pixelRatio, 1, -10 * pixelRatio );

		freq += incr;
	}
}

/**
 * Clear the playlist
 */
function clearPlaylist() {
	playlist = [];
	playlistPos = 0;
	updatePlaylistUI();
}

/**
 * Read contents from playlists.cfg
 */
function loadPlaylistsCfg() {

	var list, item, n = 0;

	fetch( 'playlists.cfg' )
		.then( function( response ) {
			if ( response.status == 200 )
				return response.text();
			else
				consoleLog( 'No playlists.cfg file found', true );
		})
		.then( function( content ) {
			list = content.split(/[\r\n]+/);
			for ( var i = 0; i < list.length; i++ ) {
				if ( list[ i ].charAt(0) != '#' && list[ i ].trim() != '' ) { // not a comment or blank line?
					item = list[ i ].split(/\|/);
					if ( item.length == 2 ) {
						elPlaylists.options[ elPlaylists.options.length ] = new Option( item[0].trim(), item[1].trim() );
						n++;
					}
				}
			}
			if ( n )
				consoleLog( n + ' playlists found in playlists.cfg' );
			else
				consoleLog( 'No playlists found in playlists.cfg', true );
		})
		.catch( function( err ) {
			consoleLog( 'Could not read from playlists.cfg', true );
		});
}

/**
 * Load a song or playlist file into the current playlist
 */
function loadPlaylist() {

	var path = elPlaylists.value,
		tmplist, ext,
		n = 0;

	// fix for suspended audio context on Safari
	if ( audioCtx.state == 'suspended' )
		audioCtx.resume();

	if ( ! path )
		return;

	ext = path.substring( path.lastIndexOf('.') + 1 );

	if ( ext == 'm3u' || ext == 'm3u8' ) {
		fetch( path )
			.then( function( response ) {
				if ( response.status == 200 )
					return response.text();
				else
					consoleLog( 'Fetch returned error code ' + response.status, true );
			})
			.then( function( content ) {
				tmplist = content.split(/[\r\n]+/);
				path = path.substring( 0, path.lastIndexOf('/') + 1 );
				for ( var i = 0; i < tmplist.length; i++ ) {
					if ( tmplist[ i ].charAt(0) != '#' && tmplist[ i ].trim() != '' ) { // not a comment or blank line?
						n++;
						if ( tmplist[ i ].substring( 0, 4 ) != 'http' )
							playlist.push( path + tmplist[ i ] );
						else
							playlist.push( tmplist[ i ] );
					}
				}
				consoleLog( 'Loaded ' + n + ' files into the playlist' );
				updatePlaylistUI();
				if ( ! isPlaying() )
					loadSong( 0 );
			})
			.catch( function( err ) {
				consoleLog( err, true );
			});
	}
	else {
		playlist.push( path ); // single file
		consoleLog( 'Loaded 1 file into the playlist' );
		updatePlaylistUI();
		if ( ! isPlaying() )
			loadSong( 0 );
	}

}

/**
 * Update the playlist shown to the user
 */
function updatePlaylistUI() {

	var	elPlaylist = document.getElementById('playlist'),
		songname;

	while ( elPlaylist.hasChildNodes() )
		elPlaylist.removeChild( elPlaylist.firstChild );

	for ( var i = 0; i < playlist.length; i++ ) {
		songname = playlist[ i ].substring( playlist[ i ].lastIndexOf('/') + 1 );
		songname = songname.substring( 0, songname.lastIndexOf('.') ).replace( /_/g, ' ' );
		elPlaylist.appendChild( new Option( songname ) );
	}

	elPlaylist.selectedIndex = playlistPos;
}

/**
 * Shuffle the playlist
 */
function shufflePlaylist() {

	var temp, r;

	for ( var i = playlist.length - 1; i > 0; i-- ) {
		r = Math.floor( Math.random() * ( i + 1 ) );
		temp = playlist[ i ];
		playlist[ i ] = playlist[ r ];
		playlist[ r ] = temp;
		if ( isPlaying() ) {
			if ( playlistPos == i )
				playlistPos = r;
			else if ( playlistPos == r )
				playlistPos = i;
		}
	}

	updatePlaylistUI();
}

/**
 * Load a song into the audio element
 */
function loadSong( n ) {
	if ( playlist[ n ] !== undefined ) {
		playlistPos = n;
		audioElement.src = playlist[ playlistPos ];
		document.getElementById('playlist').selectedIndex = playlistPos;
		return true;
	}
	else
		return false;
}

/**
 * Play a song from the playlist
 */
function playSong( n ) {
	if ( cfgSource == 'mic' )
		return;
	if ( loadSong( n ) )
		audioElement.play();
}

/**
 * Player controls
 */
function playPause() {
	if ( cfgSource == 'mic' )
		return;
	if ( isPlaying() )
		audioElement.pause();
	else if ( audioElement.src != '' )
		audioElement.play();
}

function stop() {
	if ( cfgSource == 'mic' )
		return;
	audioElement.pause();
	loadSong( 0 );
}

function playPreviousSong() {
	if ( cfgSource == 'mic' )
		return;
	if ( isPlaying() )
		playSong( playlistPos - 1 );
	else
		loadSong( playlistPos - 1 );
}

function playNextSong() {
	if ( cfgSource == 'mic' )
		return;
	if ( isPlaying() )
		playSong( playlistPos + 1 );
	else
		loadSong( playlistPos + 1 );
}

/**
 * Check if audio is playing
 */
function isPlaying() {
	return audioElement
		&& audioElement.currentTime > 0
		&& !audioElement.paused
		&& !audioElement.ended;
//		&& audioElement.readyState > 2;
}


/**
 * Redraw the canvas
 * this is called 60 times per second by requestAnimationFrame()
 */
function draw() {

	var barWidth, barHeight,
		grad = elGradient.selectedIndex;

	// clear the canvas, using the background color stored in the selected gradient option
	canvasCtx.fillStyle = elGradient.value;
	canvasCtx.fillRect( 0, 0, canvas.width, canvas.height );

	// get a new array of data from the FFT
	analyser.getByteFrequencyData( dataArray );

	// for log scale, bar width is always 1; for linear scale we show wider bars when possible
	barWidth = ( ! cfgLogScale && bandWidth >= 2 ) ? Math.floor( bandWidth ) - 1 : 1;

	for ( var i = iMin; i <= iMax; i++ ) {
		barHeight = dataArray[ i ] / 255 * canvas.height;

		if ( peaks[ i ] === undefined || barHeight > peaks[ i ] ) {
			peaks[ i ] = barHeight;
			hold[ i ] = 30; // hold peak dot for 30 frames (0.5s) before starting to fall down
			accel[ i ] = 0;
		}

		canvasCtx.fillStyle = gradients[ grad ];

		if ( posx[ i ] >= 0 ) {	// ignore negative positions
			canvasCtx.fillRect( posx[ i ], canvas.height, barWidth, -barHeight );
			if ( cfgShowPeaks && peaks[ i ] > 0 ) {
				canvasCtx.fillRect( posx[ i ], canvas.height - peaks[ i ], barWidth, 2 );
// debug/calibration - show frequency for each bar (warning: super slow!)
//				canvasCtx.fillText( String( i * audioCtx.sampleRate / analyser.fftSize ), posx[ i ], canvas.height - peaks[i] - 5 );
			}
			if ( peaks[ i ] > 0 ) {
				if ( hold[ i ] )
					hold[ i ]--;
				else {
					accel[ i ]++;
					peaks[ i ] -= accel[ i ];
				}
			}
		}
	}

	if ( cfgShowScale )
		drawScale();

	// schedule next canvas update
	requestAnimationFrame( draw );
}

/**
 * Output messages to the UI "console"
 */
function consoleLog( msg, error = false ) {
	var elConsole = document.getElementById( 'console' );
	if ( error )
		msg = '<span class="error"><i class="icons8-warn"></i> ' + msg + '</span>';
	elConsole.innerHTML += msg + '<br>';
	elConsole.scrollTop = elConsole.scrollHeight;
}

/**
 * Change audio input source
 */
function setSource() {

	cfgSource = elSource.value;

	if ( cfgSource == 'mic' ) {
		if ( typeof sourceMic == 'object' ) {
			if ( isPlaying() )
				audioElement.pause();
			sourcePlayer.disconnect( analyser );
			sourceMic.connect( analyser );
		}
		else { // if sourceMic is not set yet, ask user's permission to use the microphone
			navigator.mediaDevices.getUserMedia( { audio: true, video: false } )
			.then( function( stream ) {
				sourceMic = audioCtx.createMediaStreamSource( stream );
				consoleLog( 'Audio source set to microphone' );
				setSource(); // recursive call, sourceMic is now set
			})
			.catch( function( err ) {
				consoleLog( 'Could not change audio source', true );
				elSource.selectedIndex = 0; // revert to player
				cfgSource = 'player';
			});
		}
	}
	else {
		if ( typeof sourceMic == 'object' )
			sourceMic.disconnect( analyser );
		sourcePlayer.connect( analyser );
		consoleLog( 'Audio source set to built-in player' );
	}

}

/**
 * Save gradient preference
 */
function setGradient() {

	docCookies.setItem( 'gradient', elGradient.selectedIndex, Infinity );
}

/**
 * Load a music file from the user's computer
 */
function loadLocalFile( obj ) {

	var reader = new FileReader();

	reader.onload = function() {
		audioElement.src = reader.result;
		audioElement.play();
	}

	reader.readAsDataURL( obj.files[0] );
}


/**
 * Initialization
 */
function initialize() {

	playlist = [];
	playlistPos = 0;

	posx = [];

	consoleLog( 'audioMotion.js version ' + _VERSION );
	consoleLog( 'Initializing...' );

	// create audio context

	try {
		audioCtx = new ( window.AudioContext || window.webkitAudioContext )();
	}
	catch( err ) {
		consoleLog( 'Could not create audio context. WebAudio API not supported?', true );
		consoleLog( 'Aborting.' );
		return false;
	}

	consoleLog( 'Audio context sample rate is ' + audioCtx.sampleRate + 'Hz' );

	audioElement = document.getElementById('player');

	audioElement.addEventListener( 'play', function() {
		if ( playlist.length == 0 && audioElement.src == '' ) {
			consoleLog( 'Playlist is empty', true );
			audioElement.pause();
		}
	});

	audioElement.addEventListener( 'ended', function() {
		// song ended, skip to next one if available
		if ( playlistPos < playlist.length - 1 )
			playSong( playlistPos + 1 );
		else if ( document.getElementById('repeat').dataset.active == '1' )
			playSong( 0 );
		else
			loadSong( 0 );
	});

	audioElement.addEventListener( 'error', function() {
		consoleLog( 'Error loading ' + this.src, true );
	});

	analyser = audioCtx.createAnalyser();
	sourcePlayer = audioCtx.createMediaElementSource( audioElement );
	sourcePlayer.connect( analyser );
	analyser.connect( audioCtx.destination );

	// canvas

	canvas = document.getElementById('canvas');

	pixelRatio = window.devicePixelRatio; // for Retina / HiDPI devices

	// Adjust canvas width and height to match the display's resolution
	canvas.width = window.screen.width * pixelRatio;
	canvas.height = window.screen.height * pixelRatio;

	// Always consider landscape orientation
	if ( canvas.height > canvas.width ) {
		var tmp = canvas.width;
		canvas.width = canvas.height;
		canvas.height = tmp;
	}

	consoleLog( 'Canvas size is ' + canvas.width + 'x' + canvas.height + ' pixels' );

	canvasCtx = canvas.getContext('2d');
	canvasCtx.fillStyle = '#000';
	canvasCtx.fillRect(0, 0, canvas.width, canvas.height);

	// create gradients

	gradients = [];

	var gradinfo = [
		// gradient name, background color, and color stops
		{ name: 'Classic', bg: '#111', colorstops: [
				{ stop: .1, color: 'hsl( 0, 100%, 50% )' },
				{ stop: .6, color: 'hsl( 60, 100%, 50% )' },
				{ stop:  1, color: 'hsl( 120, 100%, 50% )' }
		] },
		{ name: 'Aurora 1', bg: '#0e172a', colorstops: [
				{ stop: .1, color: 'hsl( 120, 100%, 50% )' },
				{ stop:  1, color: 'hsl( 216, 100%, 50% )' }
		] },
		{ name: 'Aurora 2', bg: '#0e172a', colorstops: [
				{ stop: .1, color: 'hsl( 120, 100%, 50% )' },
				{ stop:  1, color: 'hsla( 320, 100%, 50%, .4 )' }
		] },
		{ name: 'Aurora 3', bg: '#0e172a', colorstops: [
				{ stop: .1, color: 'hsl( 120, 100%, 50% )' },
				{ stop: .7, color: 'hsla( 189, 100%, 50%, .8 )' },
				{ stop:  1, color: 'hsla( 245, 80%, 50%, .4 )' }
		] },
		{ name: 'Aurora 4', bg: '#0e172a', colorstops: [
				{ stop: .1, color: 'hsl( 120, 100%, 50% )' },
				{ stop: .5, color: 'hsl( 189, 100%, 40% )' },
				{ stop:  1, color: 'hsl( 290, 60%, 40% )' }
		] },
		{ name: 'Dusk', bg: '#0e172a', colorstops: [
				{ stop: .2, color: 'hsl( 55, 100%, 50% )' },
				{ stop:  1, color: 'hsl( 16, 100%, 50% )' }
		] }
	];

	var grad, i, j;

	elGradient = document.getElementById('gradient');

	for ( i = 0; i < gradinfo.length; i++ ) {
		grad = canvasCtx.createLinearGradient( 0, 0, 0, canvas.height );
		for ( j = 0; j < gradinfo[ i ].colorstops.length; j++ )
			grad.addColorStop( gradinfo[ i ].colorstops[ j ].stop, gradinfo[ i ].colorstops[ j ].color );
		// add the option to the html select element
		// we'll know which gradient to use by the selectedIndex - bg color is stored in the option value
		elGradient.options[ i ] = new Option( gradinfo[ i ].name, gradinfo[ i ].bg );
		// push the actual gradient into the gradients array
		gradients.push( grad );
	}

	// Rainbow gradients are easily created iterating over the hue value

	grad = canvasCtx.createLinearGradient( 0, 0, 0, canvas.height );
	for ( i = 0; i <= 230; i += 15 )
		grad.addColorStop( i/230, `hsl( ${i}, 100%, 50% )` );
	gradients.push( grad );
	elGradient.options[ elGradient.options.length ] = new Option( 'Rainbow', '#111' );

	grad = canvasCtx.createLinearGradient( 0, 0, canvas.width, 0 );
	for ( i = 0; i <= 360; i += 15 )
		grad.addColorStop( i/360, `hsl( ${i}, 100%, 50% )` );
	gradients.push( grad );
	elGradient.options[ elGradient.options.length ] = new Option( 'Rainbow 2', '#111' );

	// Add event listeners to the custom checkboxes

	var switches = document.querySelectorAll('.switch');
	for ( i = 0; i < switches.length; i++ ) {
		switches[ i ].addEventListener( 'click', function( e ) {
			e.target.dataset.active = Number( ! Number( e.target.dataset.active ) );
		});
	}

	// visualizer configuration

	var cookie;

	cookie = docCookies.getItem( 'freqMin' );
	elRangeMin = document.getElementById('freq_min');
	elRangeMin.selectedIndex = ( cookie !== null ) ? cookie : defaults.freqMin;

	cookie = docCookies.getItem( 'freqMax' );
	elRangeMax = document.getElementById('freq_max');
	elRangeMax.selectedIndex = ( cookie !== null ) ? cookie : defaults.freqMax;

	cookie = docCookies.getItem( 'logScale' );
	elLogScale = document.getElementById('log_scale');
	elLogScale.dataset.active = ( cookie !== null ) ? cookie : Number( defaults.logScale );
	elLogScale.addEventListener( 'click', setScale );

	cookie = docCookies.getItem( 'showScale' );
	elShowScale = document.getElementById('show_scale');
	elShowScale.dataset.active = ( cookie !== null ) ? cookie : Number( defaults.showScale );
	elShowScale.addEventListener( 'click', setScale );
	// clicks on canvas also toggle scale on/off
	canvas.addEventListener( 'click', function() {
		elShowScale.click();
	});

	cookie = docCookies.getItem( 'fftSize' );
	elFFTsize = document.getElementById('fft_size');
	elFFTsize.selectedIndex = ( cookie !== null ) ? cookie : defaults.fftSize;
	setFFTsize();

	cookie = docCookies.getItem( 'smoothing' );
	elSmoothing = document.getElementById('smoothing');
	elSmoothing.value = ( cookie !== null ) ? cookie : defaults.smoothing;
	setSmoothing();

	cookie = docCookies.getItem( 'gradient' );
	elGradient.selectedIndex = ( cookie !== null ) ? cookie : defaults.gradient;

	cookie = docCookies.getItem( 'highSens' );
	elHighSens = document.getElementById('sensitivity');
	elHighSens.dataset.active = ( cookie !== null ) ? cookie : Number( defaults.highSens );
	elHighSens.addEventListener( 'click', setSensitivity );
	setSensitivity();

	cookie = docCookies.getItem( 'showPeaks' );
	elShowPeaks = document.getElementById('show_peaks');
	elShowPeaks.dataset.active = ( cookie !== null ) ? cookie : Number( defaults.showPeaks );
	elShowPeaks.addEventListener( 'click', setShowPeaks );
	setShowPeaks();

	// set audio source to built-in player
	elSource = document.getElementById('source');
	setSource();

	// load playlists from playlists.cfg
	elPlaylists = document.getElementById('playlists');
	loadPlaylistsCfg();

	// start canvas animation
	requestAnimationFrame( draw );
}


/**
 * Initialize when window finished loading
 */

window.onload = initialize;
