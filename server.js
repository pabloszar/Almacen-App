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

// GET all column (field) names of the Inventory table from Airtable's schema.
// This includes columns that are completely empty across all records, which the
// records API would not return.
app.get('/api/columns', async (req, res) => {
  try {
    const response = await fetch(
      `https://api.airtable.com/v0/meta/bases/${process.env.AIRTABLE_BASE_ID}/tables`,
      { headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}` } }
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Airtable meta API ${response.status}: ${text}`);
    }

    const data = await response.json();
    const table = data.tables?.find(t => t.name === INVENTORY_TABLE);
    if (!table) {
      return res.status(404).json({ error: `Table '${INVENTORY_TABLE}' not found` });
    }

    const columns = table.fields.map(f => f.name);
    res.json(columns);
  } catch (error) {
    console.error('Error fetching columns:', error);
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

// POST to transfer stock between warehouses
app.post('/api/inventory/transfer', async (req, res) => {
  const { transfers, sourceColumn, targetColumn } = req.body;
  if (!transfers || !Array.isArray(transfers) || !sourceColumn || !targetColumn) {
    return res.status(400).json({ error: 'Missing transfer data or columns' });
  }

  try {
    const chunkSize = 10; // Airtable max
    const updatedProducts = [];

    // Fetch the current state of these records from Airtable to accurately compute new totals
    // We fetch one by one or chunked, but since transfers are usually small, we can fetch all needed IDs.
    const ids = transfers.map(t => t._uid);
    // Airtable filter formula for multiple IDs: RECORD_ID() = 'id1' OR RECORD_ID() = 'id2'...
    const filterFormula = "OR(" + ids.map(id => `RECORD_ID() = '${id}'`).join(',') + ")";
    
    const currentRecords = await base(INVENTORY_TABLE).select({
      filterByFormula: filterFormula
    }).all();

    for (let i = 0; i < transfers.length; i += chunkSize) {
      const chunk = transfers.slice(i, i + chunkSize);
      const recordsToUpdate = chunk.map(transfer => {
        const record = currentRecords.find(r => r.id === transfer._uid);
        if (!record) return null;
        
        const currentSourceVal = Number(record.get(sourceColumn)) || 0;
        const currentTargetVal = Number(record.get(targetColumn)) || 0;
        
        const fields = {};
        // Subtract from source, add to target
        fields[sourceColumn] = Math.max(0, currentSourceVal - transfer.qty);
        fields[targetColumn] = currentTargetVal + transfer.qty;
        
        return { id: transfer._uid, fields };
      }).filter(Boolean);

      if (recordsToUpdate.length > 0) {
        const updatedRecords = await base(INVENTORY_TABLE).update(recordsToUpdate);
        updatedRecords.forEach(record => {
          updatedProducts.push({ ...record.fields, _uid: record.id });
        });
      }
    }

    res.json({ success: true, products: updatedProducts });
  } catch (error) {
    console.error('Error in bulk transfer:', error);
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
