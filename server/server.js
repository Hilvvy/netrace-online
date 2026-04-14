const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, "../client")));

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "../client/index.html"));
});

const server = http.createServer(app);

const io = new Server(server, {
    cors: { origin: "*" }
});

const COLORS = ["#00e5ff", "#00ff88", "#ffaa00", "#b060ff"];

const NODES = [
    { id: 0, x: 270, y: 510, type: "entry", label: "ENTRADA" },
    { id: 1, x: 180, y: 490, type: "normal" },
    { id: 2, x: 100, y: 440, type: "fiber", label: "FIBRA" },
    { id: 3, x: 60, y: 360, type: "normal" },
    { id: 4, x: 60, y: 270, type: "router", label: "ROUTER SAT." },
    { id: 5, x: 80, y: 185, type: "normal" },
    { id: 6, x: 140, y: 120, type: "tcp", label: "TCP" },
    { id: 7, x: 210, y: 75, type: "normal" },
    { id: 8, x: 270, y: 55, type: "fiber", label: "FIBRA" },
    { id: 9, x: 330, y: 75, type: "normal" },
    { id: 10, x: 400, y: 120, type: "ddos", label: "DDoS" },
    { id: 11, x: 460, y: 185, type: "normal" },
    { id: 12, x: 480, y: 270, type: "router", label: "ROUTER SAT." },
    { id: 13, x: 460, y: 360, type: "normal" },
    { id: 14, x: 400, y: 440, type: "tcp", label: "TCP" },
    { id: 15, x: 320, y: 490, type: "normal" },
    { id: 16, x: 190, y: 400, type: "broadcast", label: "BROADCAST" },
    { id: 17, x: 155, y: 300, type: "normal" },
    { id: 18, x: 200, y: 200, type: "admin", label: "ADMIN" },
    { id: 19, x: 290, y: 165, type: "normal" },
    { id: 20, x: 370, y: 200, type: "ddos", label: "DDoS" },
    { id: 21, x: 400, y: 300, type: "normal" },
    { id: 22, x: 360, y: 390, type: "fiber", label: "FIBRA" },
    { id: 23, x: 270, y: 420, type: "normal" },
    { id: 24, x: 270, y: 295, type: "server", label: "SERVIDOR CENTRAL" }
];

const EDGES = [
    [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 9], [9, 10], [10, 11], [11, 12], [12, 13], [13, 14], [14, 15], [15, 0],
    [1, 16], [3, 17], [5, 18], [7, 19], [9, 20], [11, 21], [13, 22], [15, 23],
    [16, 17], [17, 18], [18, 19], [19, 20], [20, 21], [21, 22], [22, 23], [23, 16],
    [17, 24], [19, 24], [21, 24], [23, 24],
    [16, 23], [18, 17], [20, 19], [22, 21]
];

const ADJ = {};
NODES.forEach(n => ADJ[n.id] = []);
EDGES.forEach(([a, b]) => {
    ADJ[a].push(b);
    ADJ[b].push(a);
});

const rooms = {};

function createRoomCode() {
    let code = "";
    do {
        code = Math.random().toString(36).substring(2, 6).toUpperCase();
    } while (rooms[code]);
    return code;
}

function createInitialPlayer(socketId, name, index) {
    return {
        id: socketId,
        name,
        color: COLORS[index % COLORS.length],
        pos: 0,
        cards: [],
        skips: 0,
        halfMove: false,
        tcpShield: false
    };
}

function createRoomState(players) {
    return {
        players: players.map((p, i) => createInitialPlayer(p.id, p.name, i)),
        turn: 0,
        phase: "roll",
        log: [],
        blockedEdge: null,
        pendingMove: null,
        winnerId: null,
        winnerName: null,
        lastRoll: null
    };
}

function addLog(room, message) {
    room.state.log.push(message);
    if (room.state.log.length > 80) {
        room.state.log.shift();
    }
}

function currentPlayer(room) {
    return room.state.players[room.state.turn];
}

function getNode(nodeId) {
    return NODES.find(n => n.id === nodeId);
}

function isBlockedEdge(blockedEdge, a, b) {
    if (!blockedEdge) return false;
    return (
        (blockedEdge[0] === a && blockedEdge[1] === b) ||
        (blockedEdge[0] === b && blockedEdge[1] === a)
    );
}

function getValidNeighbors(room, fromId, previousId = null) {
    return ADJ[fromId].filter(nextId => {
        if (isBlockedEdge(room.state.blockedEdge, fromId, nextId)) {
            return false;
        }

        if (previousId !== null && nextId === previousId) {
            return false;
        }

        return true;
    });
}

function distanceToServer(nodeId) {
    const a = getNode(nodeId);
    const b = getNode(24);
    return Math.hypot(a.x - b.x, a.y - b.y);
}

function useShieldIfPossible(player, room, effectName) {
    if (!player.tcpShield) return false;
    player.tcpShield = false;
    addLog(room, `${player.name} bloqueó ${effectName} con TCP Shield`);
    return true;
}

function drawRandomEventCard() {
    const deck = ["PING", "DDoS ATK", "DEEP INSPECT"];
    return deck[Math.floor(Math.random() * deck.length)];
}

function addCard(player, card, room) {
    player.cards.push(card);
    addLog(room, `${player.name} obtuvo carta ${card}`);
}

function applyPassThroughEffect(room, player, nodeId) {
    const node = getNode(nodeId);

    switch (node.type) {
        case "fiber":
            room.state.pendingMove.remaining += 1;
            addLog(room, `${player.name} pasó por FIBRA y gana +1 paso`);
            break;

        case "tcp":
            addCard(player, "TCP", room);
            break;
    }
}

function checkCollision(room, player) {
    for (const other of room.state.players) {
        if (other.id === player.id) continue;
        if (other.pos !== player.pos) continue;

        const myRoll = Math.ceil(Math.random() * 6);
        const theirRoll = Math.ceil(Math.random() * 6);

        addLog(room, `¡Colisión! ${player.name}(${myRoll}) vs ${other.name}(${theirRoll})`);

        if (myRoll > theirRoll) {
            other.pos = Math.max(0, other.pos - 2);
            addLog(room, `${other.name} retrocede 2 nodos`);
        } else if (theirRoll > myRoll) {
            player.pos = Math.max(0, player.pos - 2);
            addLog(room, `${player.name} retrocede 2 nodos`);
        } else {
            addLog(room, `Empate en colisión. Ambos permanecen.`);
        }
    }
}

function applyLandingEffect(room, player) {
    const node = getNode(player.pos);

    switch (node.type) {
        case "router":
            if (!useShieldIfPossible(player, room, "Router Saturado")) {
                player.skips += 1;
                addLog(room, `${player.name} cayó en Router Saturado y pierde 1 turno`);
            }
            break;

        case "fiber": {
            addLog(room, `${player.name} cayó en FIBRA y avanza 3 nodos`);
            let current = player.pos;
            let previous = null;

            for (let i = 0; i < 3; i++) {
                const valid = getValidNeighbors(room, current, previous);
                if (!valid.length) break;

                valid.sort((a, b) => distanceToServer(a) - distanceToServer(b));
                const next = valid[0];
                previous = current;
                current = next;

                applyPassThroughEffect(room, player, current);
            }

            player.pos = current;

            if (player.pos === 24) {
                room.state.phase = "ack";
                addLog(room, `${player.name} llegó al Servidor Central. Debe lanzar ACK.`);
                return;
            }
            break;
        }

        case "tcp":
            addCard(player, "TCP", room);
            break;

        case "ddos":
            if (!useShieldIfPossible(player, room, "DDoS")) {
                addLog(room, `${player.name} cayó en DDoS y retrocede 2 nodos`);
                let current = player.pos;

                for (let i = 0; i < 2; i++) {
                    const possible = ADJ[current].filter(next => !isBlockedEdge(room.state.blockedEdge, current, next));
                    if (!possible.length) break;

                    possible.sort((a, b) => distanceToServer(b) - distanceToServer(a));
                    current = possible[0];
                }

                player.pos = current;
            }
            break;

        case "broadcast":
            room.state.players.forEach(p => p.halfMove = true);
            addLog(room, "Broadcast activado. Todos moverán a la mitad en su próximo turno");
            break;

        case "admin":
            addCard(player, "RECONFIG", room);
            break;

        case "server":
            room.state.phase = "ack";
            addLog(room, `${player.name} llegó al Servidor Central. Debe lanzar ACK.`);
            return;
    }

    checkCollision(room, player);

    if (Math.random() < 0.25) {
        addCard(player, drawRandomEventCard(), room);
    }

    room.state.phase = "done";
}

function continueMovement(room) {
    const move = room.state.pendingMove;
    const player = currentPlayer(room);

    while (move && move.remaining > 0) {
        const neighbors = getValidNeighbors(room, move.current, move.previous);

        if (!neighbors.length) {
            break;
        }

        if (neighbors.length > 1) {
            room.state.phase = "choose";
            move.options = neighbors;
            addLog(room, `${player.name} debe elegir ruta`);
            return;
        }

        const next = neighbors[0];
        move.previous = move.current;
        move.current = next;
        player.pos = next;
        move.remaining -= 1;

        if (move.remaining > 0) {
            applyPassThroughEffect(room, player, next);
        }
    }

    player.pos = move.current;
    room.state.pendingMove = null;
    applyLandingEffect(room, player);
}

function emitState(code) {
    const room = rooms[code];
    if (!room) return;

    io.to(code).emit("state_update", {
        ...room.state,
        roomCode: code,
        playersLobby: room.players,
        hostId: room.hostId
    });
}

function emitPlayersUpdate(code) {
    const room = rooms[code];
    if (!room) return;

    io.to(code).emit("players_update", {
        players: room.players,
        hostId: room.hostId
    });
}

function ensureRoom(code, socket) {
    const room = rooms[code];
    if (!room) {
        socket.emit("error_msg", "Sala no existe");
        return null;
    }
    return room;
}

function ensureMyTurn(room, socket) {
    const player = currentPlayer(room);
    return player && player.id === socket.id;
}

function ensureHost(room, socket) {
    return room && room.hostId === socket.id;
}

io.on("connection", (socket) => {
    console.log("Jugador conectado:", socket.id);

    socket.on("create_room", ({ name }) => {
        const safeName = (name || "Jugador").trim().slice(0, 20);
        const code = createRoomCode();

        rooms[code] = {
            hostId: socket.id,
            players: [{ id: socket.id, name: safeName }],
            state: null
        };

        socket.join(code);

        socket.emit("room_created", { code, hostId: socket.id });
        emitPlayersUpdate(code);
    });

    socket.on("join_room", ({ code, name }) => {
        const room = ensureRoom(code, socket);
        if (!room) return;

        if (room.players.length >= 4) {
            socket.emit("error_msg", "La sala ya está llena");
            return;
        }

        if (room.state) {
            socket.emit("error_msg", "La partida ya inició");
            return;
        }

        const alreadyInRoom = room.players.some(p => p.id === socket.id);
        if (alreadyInRoom) {
            emitPlayersUpdate(code);
            return;
        }

        const safeName = (name || "Jugador").trim().slice(0, 20);
        room.players.push({ id: socket.id, name: safeName });
        socket.join(code);

        emitPlayersUpdate(code);
    });

    socket.on("start_game", ({ code }) => {
        const room = ensureRoom(code, socket);
        if (!room) return;

        if (!ensureHost(room, socket)) {
            socket.emit("error_msg", "Solo el creador de la sala puede iniciar la partida");
            return;
        }

        if (!room.players.length) return;

        if (room.state) {
            socket.emit("error_msg", "La partida ya inició");
            return;
        }

        room.state = createRoomState(room.players);
        addLog(room, `Partida iniciada. Turno de ${room.state.players[0].name}`);

        io.to(code).emit("game_started", {
            ...room.state,
            roomCode: code,
            playersLobby: room.players,
            hostId: room.hostId
        });
    });

    socket.on("roll_dice", ({ code }) => {
        const room = ensureRoom(code, socket);
        if (!room || !room.state) return;
        if (!ensureMyTurn(room, socket)) return;
        if (room.state.phase !== "roll") return;

        const player = currentPlayer(room);

        if (player.skips > 0) {
            player.skips -= 1;
            addLog(room, `${player.name} pierde turno`);
            room.state.phase = "done";
            emitState(code);
            return;
        }

        let roll = Math.ceil(Math.random() * 6);

        if (player.halfMove) {
            roll = Math.max(1, Math.ceil(roll / 2));
            player.halfMove = false;
            addLog(room, `${player.name} sufre Broadcast y mueve solo ${roll}`);
        }

        room.state.lastRoll = roll;
        addLog(room, `${player.name} lanzó ${roll}`);

        room.state.pendingMove = {
            playerId: player.id,
            current: player.pos,
            previous: null,
            remaining: roll,
            options: []
        };

        continueMovement(room);
        emitState(code);
    });

    socket.on("choose_path", ({ code, nodeId }) => {
        const room = ensureRoom(code, socket);
        if (!room || !room.state) return;
        if (!ensureMyTurn(room, socket)) return;
        if (room.state.phase !== "choose") return;
        if (!room.state.pendingMove) return;

        const move = room.state.pendingMove;
        const player = currentPlayer(room);

        if (!move.options.includes(nodeId)) return;

        move.previous = move.current;
        move.current = nodeId;
        player.pos = nodeId;
        move.remaining -= 1;

        if (move.remaining > 0) {
            applyPassThroughEffect(room, player, nodeId);
        }

        continueMovement(room);
        emitState(code);
    });

    socket.on("roll_ack", ({ code }) => {
        const room = ensureRoom(code, socket);
        if (!room || !room.state) return;
        if (!ensureMyTurn(room, socket)) return;
        if (room.state.phase !== "ack") return;

        const player = currentPlayer(room);
        const roll = Math.ceil(Math.random() * 6);
        room.state.lastRoll = roll;

        if (roll % 2 === 0) {
            room.state.phase = "finished";
            room.state.winnerId = player.id;
            room.state.winnerName = player.name;
            addLog(room, `${player.name} lanzó ACK ${roll} y ganó la partida`);
        } else {
            room.state.phase = "done";
            addLog(room, `${player.name} lanzó ACK ${roll} y falló la confirmación`);
        }

        emitState(code);
    });

    socket.on("use_card", ({ code, cardIndex }) => {
        const room = ensureRoom(code, socket);
        if (!room || !room.state) return;
        if (!ensureMyTurn(room, socket)) return;
        if (room.state.phase !== "roll" && room.state.phase !== "done") return;

        const player = currentPlayer(room);
        if (cardIndex < 0 || cardIndex >= player.cards.length) return;

        const card = player.cards.splice(cardIndex, 1)[0];
        addLog(room, `${player.name} usó ${card}`);

        switch (card) {
            case "TCP":
                player.tcpShield = true;
                addLog(room, `${player.name} activó TCP Shield`);
                break;

            case "RECONFIG":
                if (!room.state.blockedEdge) {
                    const validEdges = EDGES.filter(([a, b]) =>
                        !((a === 17 && b === 24) || (a === 19 && b === 24) || (a === 21 && b === 24) || (a === 23 && b === 24))
                    );
                    room.state.blockedEdge = validEdges[Math.floor(Math.random() * validEdges.length)];
                    addLog(room, `Ruta bloqueada: ${room.state.blockedEdge[0]} ↔ ${room.state.blockedEdge[1]}`);
                } else {
                    room.state.blockedEdge = null;
                    addLog(room, `Bloqueo de ruta eliminado`);
                }
                break;

            case "PING": {
                const cardDrawn = ["TCP", "RECONFIG", "DDoS ATK"][Math.floor(Math.random() * 3)];
                player.cards.push(cardDrawn);
                addLog(room, `${player.name} robó ${cardDrawn} con PING`);
                break;
            }

            case "DDoS ATK": {
                const targets = room.state.players.filter(p => p.id !== player.id);
                if (targets.length) {
                    const target = targets[Math.floor(Math.random() * targets.length)];
                    if (!useShieldIfPossible(target, room, "DDoS ATK")) {
                        target.pos = Math.max(0, target.pos - 2);
                        addLog(room, `${target.name} retrocede 2 por DDoS ATK`);
                    }
                }
                break;
            }

            case "DEEP INSPECT": {
                const targets = room.state.players.filter(p => p.id !== player.id && p.cards.length > 0);
                if (targets.length) {
                    const target = targets[Math.floor(Math.random() * targets.length)];
                    const removed = target.cards.shift();
                    addLog(room, `${player.name} descartó ${removed} de ${target.name}`);
                } else {
                    addLog(room, `No había oponentes con cartas`);
                }
                break;
            }
        }

        emitState(code);
    });

    socket.on("end_turn", ({ code }) => {
        const room = ensureRoom(code, socket);
        if (!room || !room.state) return;
        if (!ensureMyTurn(room, socket)) return;
        if (room.state.phase !== "done") return;

        room.state.pendingMove = null;
        room.state.turn = (room.state.turn + 1) % room.state.players.length;
        room.state.phase = "roll";
        room.state.lastRoll = null;

        addLog(room, `Turno de ${currentPlayer(room).name}`);
        emitState(code);
    });

    socket.on("disconnect", () => {
        console.log("Jugador desconectado:", socket.id);

        for (const code of Object.keys(rooms)) {
            const room = rooms[code];

            room.players = room.players.filter(p => p.id !== socket.id);

            if (room.hostId === socket.id && room.players.length > 0) {
                room.hostId = room.players[0].id;
            }

            if (room.state) {
                room.state.players = room.state.players.filter(p => p.id !== socket.id);

                if (room.state.players.length === 0) {
                    delete rooms[code];
                    continue;
                }

                if (room.state.turn >= room.state.players.length) {
                    room.state.turn = 0;
                }

                if (currentPlayer(room) == null) {
                    room.state.turn = 0;
                }
            }

            if (room.players.length === 0) {
                delete rooms[code];
            } else {
                emitPlayersUpdate(code);
                if (room.state) emitState(code);
            }
        }
    });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`Servidor en http://localhost:${PORT}`);
});