# Guía de Integración con Sistema de Contabilidad (Laravel)

Esta guía explica cómo enviar mensajes de WhatsApp directamente desde tus controladores o servicios de Laravel (por ejemplo, al registrar una venta, enviar una factura o notificar cobros).

## 1. Crear Helper o Servicio en Laravel

Crea la clase `app/Services/WhatsAppService.php` en tu proyecto Laravel:

```php
<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class WhatsAppService
{
    protected string $baseUrl;
    protected string $apiKey;

    public function __construct()
    {
        $this->baseUrl = config('services.chatbot.url', 'http://localhost:3000');
        $this->apiKey = config('services.chatbot.api_key', '');
    }

    /**
     * Enviar mensaje de WhatsApp a un cliente
     */
    public function sendMessage(string $phone, string $text, ?string $clientName = null, ?string $mediaUrl = null): bool
    {
        try {
            $response = Http::withHeaders([
                'X-API-KEY' => $this->apiKey,
                'Content-Type' => 'application/json',
            ])->post("{$this->baseUrl}/api/v1/messages/send", [
                'phone' => $phone,
                'name' => $clientName ?? $phone,
                'channel' => 'whatsapp_cloud', // o 'whatsapp_evolution'
                'text' => $text,
                'media_url' => $mediaUrl,
            ]);

            if ($response->successful()) {
                Log::info("WhatsApp enviado a {$phone}: {$text}");
                return true;
            }

            Log::error("Error enviando WhatsApp: " . $response->body());
            return false;
        } catch (\Exception $e) {
            Log::error("Excepción en WhatsAppService: " . $e->getMessage());
            return false;
        }
    }
}
```

## 2. Configurar `config/services.php`

```php
'chatbot' => [
    'url' => env('CHATBOT_HUB_URL', 'http://localhost:3000'),
    'api_key' => env('CHATBOT_HUB_API_KEY', 'tu_api_key_aqui'),
],
```

## 3. Ejemplo de Uso en tu Controlador (Ej: `DynamicSaleController.php`)

```php
use App\Services\WhatsAppService;

class DynamicSaleController extends Controller
{
    public function store(Request $request, WhatsAppService $whatsApp)
    {
        // ... Guardar venta en la BD ...

        // Notificar al cliente por WhatsApp
        if ($sale->customer_phone) {
            $msg = "Hola {$sale->customer_name}, tu venta #{$sale->sale_number} ha sido procesada con éxito por un total de $" . number_format($sale->total, 2);
            $whatsApp->sendMessage($sale->customer_phone, $msg, $sale->customer_name);
        }

        return redirect()->back()->with('success', 'Venta registrada y notificada por WhatsApp.');
    }
}
```
