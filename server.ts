import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`no answer within ${Math.round(ms / 1000)}s`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;
  const isProd = process.env.NODE_ENV === 'production';

  app.use(express.json({ limit: '25mb' }));

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  // OCR Bill Endpoint using Server-Side Gemini API
  app.post('/api/ocr-bill', async (req, res) => {
    try {
      const { imageBase64, mimeType } = req.body;
      if (!imageBase64) {
        return res.status(400).json({ success: false, error: 'No image data provided' });
      }

      let cleanBase64 = imageBase64;
      let detectedMime = mimeType || 'image/jpeg';

      if (cleanBase64.startsWith('data:')) {
        const match = cleanBase64.match(/^data:([^;]+);base64,(.+)$/);
        if (match) {
          detectedMime = match[1];
          cleanBase64 = match[2];
        }
      }

      const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
      if (!apiKey) {
        return res.status(500).json({
          success: false,
          error: 'GEMINI_API_KEY is not configured on the server. Please check your environment configuration.',
        });
      }

      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      // Try each model in turn; never wait forever for one answer.
      const OCR_MODELS = (process.env.OCR_MODELS || 'gemini-3.8-flash,gemini-flash-latest,gemini-flash-lite-latest')
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
      const callModel = (model: string) => withTimeout(ai.models.generateContent({
        model,
        contents: [
          {
            inlineData: {
              mimeType: detectedMime,
              data: cleanBase64,
            },
          },
          {
            text: `You are an expert OCR system specialized in reading Indian estimate slips, bill memos, and handwritten invoices.
These bills are often handwritten on printed pads, sometimes mixing Gujarati and English (numerals or notes in Gujarati/English, product codes, battery models, raw material codes, etc.).

Analyze this bill photo and extract the following details into the required JSON format:
- customerName: Customer name or firm name (M/s. ...). If not found or illegible, return "".
- customerPhone: Phone or mobile number (digits only or formatted). If not found, return "".
- customerAddress: City, town, or address. If not found, return "".
- memoNumber: Slip number / Memo number / Bill number (often in red print, stamped, or written at the top). If not found, return "".
- billDate: Bill date formatted strictly as YYYY-MM-DD. IMPORTANT: on these Indian slips the date is ALWAYS written DAY/MONTH/YEAR, so 05/11/2026 means 5 November 2026 (2026-11-05) - never read it as May or January. A month written like '11', '||', 'll' or '1l' is 11. Today is ${new Date().toISOString().slice(0, 10)}; the bill date is normally today or a few weeks earlier and never in the future. If the year is 2 digits like '26', interpret as 2026. If unreadable, return "".
- items: An array of items listed on the slip:
  * name: The product code/model only, WITHOUT any packing note in brackets (write "WB.40Z" for "wb. 40z (3x3)", "WB.30" for "wb.30 (1x1)", "JB.30" for "JB.30"). Write codes in CAPITAL letters, keep the dot, no extra spaces (e.g. "WB.30", "JB.30", "12/12 GRAY BLUE").
  * quantity: The numeric quantity as a positive number. If unreadable, return 0.
  * rate: The unit rate or price per piece in rupees (number). If not stated or unreadable, return 0.

Strict Rules:
- Return ONLY factual data seen in the image.
- If any field cannot be read with confidence, return empty string ("") or 0. NEVER guess, fabricate, or hallucinate.`,
          },
        ],
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              customerName: { type: Type.STRING },
              customerPhone: { type: Type.STRING },
              customerAddress: { type: Type.STRING },
              memoNumber: { type: Type.STRING },
              billDate: { type: Type.STRING },
              items: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING },
                    quantity: { type: Type.NUMBER },
                    rate: { type: Type.NUMBER },
                  },
                  required: ['name', 'quantity', 'rate'],
                },
              },
            },
            required: ['customerName', 'customerPhone', 'customerAddress', 'memoNumber', 'billDate', 'items'],
          },
        },
      }), 35000);

      let response: any = null;
      let lastErr: any = null;
      const modelErrors: string[] = [];
      const isBusy = (msg: string) => /\b(503|429)\b|UNAVAILABLE|RESOURCE_EXHAUSTED|high demand|overloaded/i.test(msg);
      let allBusy = true;
      outer: for (const model of OCR_MODELS) {
        // Gemini often answers "503 high demand" for a few seconds: retry the same model before moving on.
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            response = await callModel(model);
            console.log('OCR bill read with model:', model, 'attempt', attempt);
            break outer;
          } catch (e: any) {
            lastErr = e;
            const msg = String(e?.message || e);
            modelErrors.push(model + ' #' + attempt + ': ' + msg.slice(0, 200));
            console.error('OCR model failed:', model, 'attempt', attempt, msg);
            if (!isBusy(msg)) {
              if (!/no answer within/i.test(msg)) allBusy = false;
              break; // not a "busy" error - try the next model
            }
            await new Promise((r) => setTimeout(r, 1500 * attempt));
          }
        }
      }
      if (!response) {
        throw new Error(allBusy
          ? 'Google Gemini is very busy right now and could not read the bill. Please wait a minute and tap Read again, or type the details yourself.'
          : 'Could not read the bill photo (' + modelErrors.join(' | ') + '). Please type the details or try again.');
      }

      const responseText = response.text || '{}';
      let parsedData;
      try {
        parsedData = JSON.parse(responseText);
      } catch (err: any) {
        console.error('Error parsing Gemini JSON response:', responseText, err);
        return res.status(500).json({ success: false, error: 'Failed to parse Gemini OCR output' });
      }

      return res.json({
        success: true,
        data: parsedData,
      });
    } catch (error: any) {
      console.error('OCR Processing error:', error);
      return res.status(500).json({
        success: false,
        error: error?.message || 'Error processing bill photo with Gemini',
      });
    }
  });

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
