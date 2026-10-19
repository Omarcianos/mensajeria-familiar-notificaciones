
const express = require("express");
const admin = require("firebase-admin");

const app = express();
app.use(express.json());

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

app.post("/notificar", async (req, res) => {
    try {
        const autorizacion = req.headers.authorization || "";

        if (!autorizacion.startsWith("Bearer ")) {
            return res.status(401).json({
                error: "Falta el token de autenticacion."
            });
        }

        const tokenUsuario = autorizacion.substring(7);
        const usuarioAutenticado =
            await admin.auth().verifyIdToken(tokenUsuario);

        const { uidDestino, titulo, mensaje } = req.body;

        if (
            typeof uidDestino !== "string" ||
            typeof titulo !== "string" ||
            typeof mensaje !== "string" ||
            !uidDestino.trim() ||
            !titulo.trim() ||
            !mensaje.trim()
        ) {
            return res.status(400).json({
                error: "Faltan datos para enviar la notificacion."
            });
        }

        if (
            uidDestino.length > 128 ||
            titulo.length > 100 ||
            mensaje.length > 1000
        ) {
            return res.status(400).json({
                error: "Los datos superan el limite permitido."
            });
        }

        const documento = await db
            .collection("usuarios")
            .doc(uidDestino)
            .get();

        if (!documento.exists) {
            return res.status(404).json({
                error: "No se encontro el usuario destinatario."
            });
        }

        const tokenFCM = documento.get("tokenFCM");

        if (!tokenFCM) {
            return res.status(404).json({
                error: "El destinatario no tiene un token FCM guardado."
            });
        }

        const resultado = await admin.messaging().send({
            token: tokenFCM,
            notification: {
                title: titulo,
                body: mensaje
            },
            data: {
                tipo: "general",
                remitenteId: usuarioAutenticado.uid
            },
            android: {
                priority: "high"
            }
        });

        return res.json({
            enviado: true,
            idMensaje: resultado
        });

    } catch (error) {
        console.error("Error al enviar notificacion:", error);

        if (
            error.code === "auth/argument-error" ||
            error.code === "auth/invalid-id-token" ||
            error.code === "auth/id-token-expired"
        ) {
            return res.status(401).json({
                error: "El token de autenticacion no es valido."
            });
        }

        return res.status(500).json({
            error: "No se pudo enviar la notificacion."
        });
    }
});

const puerto = process.env.PORT || 3000;

app.listen(puerto, "0.0.0.0", () => {
    console.log(`Servidor iniciado en el puerto ${puerto}`);
});
