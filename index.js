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

app.post("/notificar-chat", async (req, res) => {
    try {
        const autorizacion = req.headers.authorization || "";

        if (!autorizacion.startsWith("Bearer ")) {
            return res.status(401).json({
                error: "Falta autenticacion."
            });
        }

        const idToken = autorizacion.substring(7);
        const usuarioAutenticado =
            await admin.auth().verifyIdToken(idToken);

        const uidRemitente = usuarioAutenticado.uid;
        const mensaje = req.body.mensaje;

        if (
            typeof mensaje !== "string" ||
            !mensaje.trim() ||
            mensaje.length > 1000
        ) {
            return res.status(400).json({
                error: "Mensaje no valido."
            });
        }

        const remitente = await db
            .collection("usuarios")
            .doc(uidRemitente)
            .get();

        const nombreRemitente = remitente.exists
            ? remitente.get("nombre") || "Un familiar"
            : "Un familiar";

        const usuarios = await db.collection("usuarios").get();

        const tokens = [];

        usuarios.forEach(documento => {
            if (documento.id === uidRemitente) {
                return;
            }

            const token = documento.get("tokenFCM");

            if (typeof token === "string" && token.length > 0) {
                tokens.push(token);
            }
        });

        if (tokens.length === 0) {
            return res.json({
                enviado: true,
                notificados: 0
            });
        }

        let notificados = 0;
        let errores = 0;

        for (let i = 0; i < tokens.length; i += 500) {
            const grupo = tokens.slice(i, i + 500);

            const resultado = await admin.messaging()
                .sendEachForMulticast({
                    tokens: grupo,

                    notification: {
                        title: "Chat familiar",
                        body: nombreRemitente + ": " + mensaje
                    },

                    data: {
                        titulo: "Chat familiar",
                        mensaje: nombreRemitente + ": " + mensaje,
                        tipo: "chat",
                        remitenteId: uidRemitente
                    },

                    android: {
                        priority: "high"
                    }
                });

            notificados += resultado.successCount;
            errores += resultado.failureCount;
        }

        return res.json({
            enviado: true,
            notificados: notificados,
            errores: errores
        });

    } catch (error) {
        console.error("Error en notificacion de chat:", error);

        if (
            error.code === "auth/argument-error" ||
            error.code === "auth/invalid-id-token" ||
            error.code === "auth/id-token-expired"
        ) {
            return res.status(401).json({
                error: "Sesion no valida."
            });
        }

        return res.status(500).json({
            error: "No se pudieron enviar las notificaciones."
        });
    }
});

const puerto = process.env.PORT || 3000;

app.listen(puerto, "0.0.0.0", () => {
    console.log("Servidor iniciado en el puerto " + puerto);
});
