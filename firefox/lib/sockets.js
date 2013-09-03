'use strict';

const { Cc, Ci, CC, Cr } = require('chrome');
const { Class } = require('sdk/core/heritage');
var { EventTarget } = require("sdk/event/target");
let { emit } = require('sdk/event/core');
const { isUndefined, isNumber, isFunction } = require('sdk/lang/type');
const { ByteReader, ByteWriter } = require('sdk/io/byte-streams');


const socketTransportService = Cc["@mozilla.org/network/socket-transport-service;1"].getService(Ci.nsISocketTransportService);
// Components.classes["@mozilla.org/binaryinputstream;1"].createInstance(Components.interfaces.nsIBinaryInputStream);

// Private variables for sockets get stored in WeakMaps
// Client socket variables
let transports = new WeakMap();
let readers = new WeakMap();
let writers = new WeakMap();
// Map nsIInputStreamCallbacks to their ClientSockets
let streamCallbacks = new WeakMap();

// Server socket variables
let serverSockets = new WeakMap();
let waitingConnections = new WeakMap();
let waitingAccepts = new WeakMap();

function transportFor(socket) transports.get(socket)
function readerFor(socket) readers.get(socket)
function writerFor(socket) writers.get(socket)
function clientSocketFor(streamCallback) streamCallbacks.get(streamCallback)

function serverSocketFor(socket) serverSockets.get(socket)
function waitingConnectionsFor(socket) waitingConnections.get(socket)
function waitingAcceptsFor(socket) waitingAccepts.get(socket)

/**
 * Sets up transport and streams for a ClientSocket.
 */
var setTransport = function(socket, transport) {
  if (!isUndefined(transportFor(socket))) {
    throw 'Socket already connected';
  }

  var binaryReader = Cc["@mozilla.org/binaryinputstream;1"].createInstance(Ci.nsIBinaryInputStream);
  binaryReader.setInputStream(transport.openInputStream(0,0,0));
  // Requires new, unlike the rest of the Jetpack API
  // See https://bugzilla.mozilla.org/show_bug.cgi?id=902222
  var writer = new ByteWriter(transport.openOutputStream(0,0,0));

  transports.set(socket, transport);
  readers.set(socket, binaryReader);
  writers.set(socket, writer);
  nsIInputStreamCallback(socket);
};

/*
 * Waits for data/disconnect on a nsIAsyncInputStream
 * stream. ClientSocket isn't used as the callback to exporting
 * onInputStreamReady into the public API of ClientSocket.
 */
var nsIInputStreamCallback = Class({
  type: 'SocketReader',
  initialize: function initialize(clientSocket) {
    var binaryReader = readerFor(clientSocket);
    binaryReader.asyncWait(this, 0, 0, null);
  },
  onInputStreamReady: function onInputStreamReady() {
    var clientSocket = clientSocketFor(this);
    var binaryReader = readerFor(clientSocket);
    try {
      var bytesAvailable = binaryReader.available();
    } catch (e) {
      consoe.log(e);
      clientSocket.disconnect();
      return;
    }
    var buffer = ArrayBuffer(bytesAvailable);
    var typedBuffer = new Uint8Array(buffer);
    binaryReader.readByteArray(bytesAvailable, typedBuffer);
    emit(clientSocket, 'onData', buffer);

    binaryReader.asyncWait(this, 0, 0, null);
  }
});

var ClientSocket = Class({
  extends: EventTarget,
  type: 'ClientSocket',
  initialize: function initialize(transport, eventOptions) {
    EventTarget.prototype.initialize.call(this, eventOptions);
    if (!isUndefined(transport)) {
      setTransport(this, transport);
    }
  },
  connect: function connect(hostname, port) {
    if (!isUndefined(transportFor(socket))) {
      throw 'Socket already connected';
    }
    var transport = socketTransportService.createTransport(null, 0,
							   hostname, port, null);
    setTransport(this, transport);
  },
  write: function(data) {
    let writer = writerFor(this);
    writer.write(data);
  },
  disconnect: function() {
    [readerFor(this),
     writerFor(this),
     transportFor(this)].forEach(function close(stream) {
       stream.close(0);
     });
    emit(this, 'onDisconnect');
  }
});

var nsIServerSocketListener = Class({
  initialize: function initialize(serverSocket) {
    this.serverSocket = serverSocket;
  },
  type: 'nsIServerSocketListener',
  onSocketAccepted: function onSocketAccepted(nsiServerSocket, transport) {
    let clientSocket = ClientSocket(transport);
    if (!isUndefined(waitingAcceptsFor(this.serverSocket))) {
      waitingAcceptsFor(this.serverSocket)(clientSocket);
      waitingAccepts.put(this.serverSocket, undefined);
    } else {
      waitingConnectionsFor(this.serverSocket).push(clientSocket);
    }
  },
  onStopListening: function onStopListening(nsiServerSocket, status) {
    
  }
});

var ServerSocket = Class({
  // Address is currently ignored
  initialize: function initialize(address, port, backlog) {
    if (!isNumber(backlog)) {
      backlog = -1;
    }
    var nsiServerSocket = Cc["@mozilla.org/network/server-socket;1"]
          .createInstance(Ci.nsIServerSocket);
    nsiServerSocket.init(port, 0, backlog);
    nsiServerSocket.put(this, serverSocket);
    waitingConnections.put(this, []);
  },
  type: 'ServerSocket',
  listen: function listen() {
    let serverSocket = serverSocketFor(this);
    serverSocket.asyncListen(nsIServerSocketListener(this));
  },
  accept: function accept(callback) {
    waitingConnections = waitingConnectionsFor(this);
    if (waitingConnections.length > 0) {
      callback(waitingConnections.shift());
    } else if (isUndefined(waitingAcceptsFor(this))) {
      waitingAccepts.put(this, callback);
    }
  },
  disconnect: function disconnect() {
    serverSocketFor(this).close();
  }
});

var copyFunctions = function(source, destination) {
  for (prop in source) {
    if (isFunction(source[prop])) {
      destination[prop] = function () {
	source[prop].apply(source, arguments);
      };
    }
  }
};

var Socket = Class({
  
});

exports.ClientSocket = ClientSocket;
exports.Socket = Socket;
