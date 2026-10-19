const express = require("express");
const admin = require("firebase-admin");

const app = express();
app.use(express.json({ limit: "10kb" }));

const credenciales = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

if (!credenciales) {
    throw new Error("Falta configurar FIREBASE_SERVICE_ACCOUNT_JSON");
}

admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(credenciales))
});

const db = admin.firestore();

app.get("/", (req, res) => {
    res.send("Servidor de notificaciones de Mensajeria Familiar activo.");
});

async function autenticar(req, res) {
    const autorizacion = req.headers.authorization || "";

    if (!autorizacion.startsWith("Bearer ")) {
        res.status(401).json({ error: "Falta autenticacion." });
        return null;
    }

    try {
        return await admin.auth().verifyIdToken(
            autorizacion.substring(7)
        );
    } catch (error) {
        res.status(401).json({ error: "Sesion no valida." });
        return null;
    }
}

app.post("/notificar-chat", async (req, res) => {
    try {
        const usuario = await autenticar(req, res);
        if (!usuario) return;

        const mensaje = req.body.mensaje;

        if (
            typeof mensaje !== "string" ||
            !mensaje.trim() ||
            mensaje.length > 1000
        ) {
            return res.status(400).json({ error: "Mensaje no valido." });
        }

        const remitente = await db.collection("usuarios")
            .doc(usuario.uid).get();

        const nombre = remitente.exists
            ? remitente.get("nombre") || "Un familiar"
            : "Un familiar";

        const usuarios = await db.collection("usuarios").get();
        const tokens = [];

        usuarios.forEach(documento => {
            if (documento.id === usuario.uid) return;

            const token = documento.get("tokenFCM");
            if (typeof token === "string" && token.length > 0) {
                tokens.push(token);
            }
        });

        let notificados = 0;
        let errores = 0;

        for (let i = 0; i < tokens.length; i += 500) {
            const resultado = await admin.messaging().sendEachForMulticast({
                tokens: tokens.slice(i, i + 500),
                notification: {
                    title: "Chat familiar",
                    body: nombre + ": " + mensaje
                },
                data: {
                    titulo: "Chat familiar",
                    mensaje: nombre + ": " + mensaje,
                    tipo: "chat",
                    remitenteId: usuario.uid
                },
                android: { priority: "high" }
            });

            notificados += resultado.successCount;
            errores += resultado.failureCount;
        }

        return res.json({
            enviado: true,
            notificados,
            errores
        });

    } catch (error) {
        console.error("Error en notificacion de chat:", error);
        return res.status(500).json({
            error: "No se pudieron enviar las notificaciones."
        });
    }
});

app.post("/notificar-llamada", async (req, res) => {
    try {
        const usuario = await autenticar(req, res);
        if (!usuario) return;

        const { llamadaId, uidDestino } = req.body;

        if (
            typeof llamadaId !== "string" ||
            typeof uidDestino !== "string" ||
            !llamadaId.trim() ||
            !uidDestino.trim()
        ) {
            return res.status(400).json({
                error: "Faltan datos de la llamada."
            });
        }

        const referencia = db.collection("llamadas").doc(llamadaId);
        const llamadaDoc = await referencia.get();

        if (!llamadaDoc.exists) {
            return res.status(404).json({
                error: "La llamada no existe."
            });
        }

        const llamada = llamadaDoc.data();

        if (
            llamada.llamanteId !== usuario.uid ||
            llamada.receptorId !== uidDestino ||
            llamada.estado !== "pendiente"
        ) {
            return res.status(403).json({
                error: "La llamada no coincide con el usuario autenticado."
            });
        }

        const receptorDoc = await db.collection("usuarios")
            .doc(uidDestino).get();

        if (!receptorDoc.exists) {
            return res.status(404).json({
                error: "No se encontro al destinatario."
            });
        }

        const tokenFCM = receptorDoc.get("tokenFCM");

        if (!tokenFCM) {
            return res.status(404).json({
                error: "El destinatario no tiene token FCM."
            });
        }

        const nombre = llamada.llamanteNombre || "Un familiar";

        const idMensaje = await admin.messaging().send({
            token: tokenFCM,
            notification: {
                title: "Videollamada entrante",
                body: nombre + " te está llamando."
            },
            data: {
                titulo: "Videollamada entrante",
                mensaje: nombre + " te está llamando.",
                tipo: "llamada",
                llamadaId: llamadaId,
                remitenteId: usuario.uid
            },
            android: {
                priority: "high",
                ttl: 60 * 1000
            }
        });

        return res.json({
            enviado: true,
            idMensaje: idMensaje
        });

    } catch (error) {
        console.error("Error en notificacion de llamada:", error);
        return res.status(500).json({
            error: "No se pudo enviar la notificacion de llamada."
        });
    }
});

const puerto = process.env.PORT || 3000;

app.listen(puerto, "0.0.0.0", () => {
    console.log("Servidor iniciado en el puerto " + puerto);
});
