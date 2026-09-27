# Plan de Pruebas: Transferencias de Stock

Este informe detalla las pruebas necesarias y cómo probar los endpoints recién refactorizados en Postman. 

## Endpoints

### 1. Crear Transferencia de Stock (POST)
**Endpoint:** `POST /api/transfers`

**Descripción:** Mueve el stock desde la sucursal de origen hacia la sucursal de destino y registra un `StockTransfer` completado en un solo paso y transacción.

**Headers Recomendados:**
- `Authorization`: `Bearer <token>`
- `Content-Type`: `application/json`

**Body (JSON):**
```json
{
  "sourceBranchId": "ID_SUCURSAL_ORIGEN",
  "destinationBranchId": "ID_SUCURSAL_DESTINO",
  "notes": "Transferencia de mercadería semanal",
  "items": [
    {
      "product_id": "ID_PRODUCTO_1",
      "quantity": "10"
    },
    {
      "product_id": "ID_PRODUCTO_2",
      "quantity": "5"
    }
  ]
}
```

**Casos de prueba a verificar:**
1. **Éxito:** Responde 200 OK. Se debe validar en BD que:
   - Inventario origen: descontó cantidades.
   - Inventario destino: sumó cantidades (o creó el documento de inventario si no existía).
   - Movimientos (Kardex): se crearon `TRANSFER_OUT` en origen y `TRANSFER_IN` en destino.
   - `StockTransfer`: se creó un documento con `status: "COMPLETED"`.
2. **Error (Stock insuficiente):** Responde 400 Bad Request. Verificar que **NINGÚN** registro fue alterado o creado en BD (Rollback funciona).
3. **Error (Sucursal origen/destino igual):** Responde 400 Bad Request.
4. **Error (Item duplicado):** Responde 400 Bad Request enviando dos items con el mismo `product_id`.

---

### 2. Actualizar Estado de Transferencia (PUT)
**Endpoint:** `PUT /api/transfers/:id/status`

**Descripción:** Actualiza el estado histórico de una transferencia, típicamente para marcarla como `CANCELED`. **NO MUEVE STOCK NI AFECTA INVENTARIO.**

**Headers Recomendados:**
- `Authorization`: `Bearer <token>`
- `Content-Type`: `application/json`

**Body (JSON):**
```json
{
  "status": "CANCELED"
}
```

**Casos de prueba a verificar:**
1. **Error (COMPLETED -> COMPLETED):** Debe responder 409 Conflict ("La transferencia ya está completada").
2. **Error (COMPLETED -> CANCELED):** Debe responder 409 Conflict ("Una transferencia completada no puede cancelarse sin revertir primero el inventario").
3. **Error (CANCELED -> CANCELED/COMPLETED):** Debe responder 409 Conflict indicando que una transferencia cancelada no puede cambiar de estado.
4. **Error (PENDING -> COMPLETED):** Debe responder 409 Conflict, indicando que no se debe completar por PUT, ya que se debe hacer el POST principal de la transferencia.

## Cómo probar con Postman

Para simular este comportamiento en Postman:
1. Reemplaza las variables `{{baseUrl}}` por `http://localhost:3000` (o tu puerto).
2. Asegúrate de inyectar el `{{token}}` válido de un tenant owner / admin en las variables de entorno de Postman.
3. Asegúrate de tomar IDs reales de sucursales (`sourceBranchId`, `destinationBranchId`) y de productos (`product_id`) existentes para tu base de datos y que al menos la sucursal de origen tenga cantidad suficiente.
4. Intenta enviar un traslado mayor al inventario del origen para validar el Rollback.

> [!TIP]
> Recuerda que estos cambios asumen que el cliente web (frontend) dejará de usar llamadas al PUT para completar una transferencia. El flujo final ahora es de un solo paso: el POST ejecuta la transferencia completa y la marca como `COMPLETED`.
