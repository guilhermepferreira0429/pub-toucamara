package pt.toucamara.mobile

import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        // Canais de notificação da app do munícipe (lib/municipe/notificacoes.dart):
        // toucamara_urgente, toucamara_avisos, toucamara_processos.
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "pt.toucamara/notificacoes")
            .setMethodCallHandler { call, result ->
                if (call.method != "criarCanais") {
                    result.notImplemented()
                    return@setMethodCallHandler
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    val gestor = getSystemService(NotificationManager::class.java)
                    @Suppress("UNCHECKED_CAST")
                    val canais = call.arguments as? List<Map<String, Any>> ?: emptyList()
                    for (c in canais) {
                        val canal = NotificationChannel(
                            c["id"] as String,
                            c["nome"] as String,
                            (c["importancia"] as Number).toInt(),
                        )
                        canal.description = c["descricao"] as String
                        gestor.createNotificationChannel(canal)
                    }
                }
                result.success(null)
            }
    }
}
