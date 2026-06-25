import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import Airtable from 'airtable';
import { fileURLToPath } from 'url';
import path from 'path';

// Cargar variables de entorno
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Configuración de Airtable
const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);
const INVENTORY_TABLE = 'Inventory';
const CONFIG_TABLE = 'Configuracion';

// GET and POST for configuration (Warehouses and Aisles)
app.get('/api/config', async (req, res) => {
  try {
    const records = await base(CONFIG_TABLE).select({
      filterByFormula: "{Name} = 'app_config'",
      maxRecords: 1
    }).firstPage();
    
    if (records.length > 0) {
      const configStr = records[0].get('json_data');
      if (configStr) {
        return res.json(JSON.parse(configStr));
      }
    }
    
    // Default config if not found
    const defaultConfig = {
      almacenes: [
        { id: "PRINCIPAL", name: "Almacén Principal", stockColumn: "WHSAL/Stock" }
      ],
      floors: [],
      aisles: []
    };
    res.json(defaultConfig);
  } catch (error) {
    console.error('Error fetching config:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/config', async (req, res) => {
  try {
    const newConfig = req.body;
    const configStr = JSON.stringify(newConfig, null, 2);
    
    const records = await base(CONFIG_TABLE).select({
      filterByFormula: "{Name} = 'app_config'",
      maxRecords: 1
    }).firstPage();
    
    if (records.length > 0) {
      await base(CONFIG_TABLE).update([
        { id: records[0].id, fields: { json_data: configStr } }
      ]);
    } else {
      await base(CONFIG_TABLE).create([
        { fields: { Name: 'app_config', json_data: configStr } }
      ]);
    }
    
    res.json({ success: true, config: newConfig });
  } catch (error) {
    console.error('Error saving config:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET all inventory
app.get('/api/inventory', async (req, res) => {
  try {
    const allRecords = [];
    await base(INVENTORY_TABLE).select().eachPage((records, fetchNextPage) => {
      records.forEach(record => {
        allRecords.push({
          ...record.fields,
          _uid: record.id
        });
      });
      fetchNextPage();
    });
    
    res.json(allRecords);
  } catch (error) {
    console.error('Error fetching inventory:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST to update a product's locations and optionally total stock
app.post('/api/inventory/update', async (req, res) => {
  const { _uid, Ubicaciones_App, newStock, stockColumn } = req.body;
  if (!_uid) return res.status(400).json({ error: 'Missing product _uid' });

  try {
    const fieldsToUpdate = {};
    if (Ubicaciones_App !== undefined) {
      fieldsToUpdate['Ubicaciones_App'] = Ubicaciones_App;
    }
    if (newStock !== undefined) {
      const col = stockColumn || 'WHSAL/Stock';
      fieldsToUpdate[col] = Number(newStock) || 0;
    }

    const updatedRecords = await base(INVENTORY_TABLE).update([
      { id: _uid, fields: fieldsToUpdate }
    ]);
    
    const record = updatedRecords[0];
    res.json({ success: true, product: { ...record.fields, _uid: record.id } });
  } catch (error) {
    console.error('Error updating inventory:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST to update multiple products at once (e.g. for reordering)
app.post('/api/inventory/update-bulk', async (req, res) => {
  const { updates } = req.body;
  if (!updates || !Array.isArray(updates)) return res.status(400).json({ error: 'Missing updates array' });

  try {
    // Airtable solo permite actualizar hasta 10 registros a la vez
    const chunkSize = 10;
    const updatedProducts = [];
    
    for (let i = 0; i < updates.length; i += chunkSize) {
      const chunk = updates.slice(i, i + chunkSize);
      
      const recordsToUpdate = chunk.map(update => {
        const fields = {};
        if (update.Ubicaciones_App !== undefined) {
          fields['Ubicaciones_App'] = update.Ubicaciones_App;
        }
        if (update.newStock !== undefined) {
          const col = update.stockColumn || 'WHSAL/Stock';
          fields[col] = Number(update.newStock) || 0;
        }
        return { id: update._uid, fields };
      });

      const updatedRecords = await base(INVENTORY_TABLE).update(recordsToUpdate);
      
      updatedRecords.forEach(record => {
        updatedProducts.push({ ...record.fields, _uid: record.id });
      });
    }

    res.json({ success: true, products: updatedProducts });
  } catch (error) {
    console.error('Error in bulk update:', error);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3001;
// Solo iniciamos el servidor si NO estamos en Vercel (Vercel usa la app exportada directamente)
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

export default app;
