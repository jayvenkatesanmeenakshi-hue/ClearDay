import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export const processBrainDump = async (rawText: string) => {
  const model = "gemini-3.1-pro-preview";
  const systemInstruction = `You are ClearDay, a structured execution engine. Your purpose is to convert chaotic brain dumps into categorized tasks, realistic priorities, and actionable breakdowns.
The tone is calm, clear, structured, and practical. No fluff. No hype.

Output Format (STRICT STRUCTURE):

CATEGORIES:

Work:
- 

Personal:
- 

Health:
- 

Admin:
- 

Long-Term:
- 

PRIORITY:

Critical:
- 

Important:
- 

Optional:
- 

BREAKDOWNS:

Task: 
- Step 1
- Step 2
- Step 3

Rules:
1. Every task must be categorized.
2. Every task must receive a priority.
3. Large tasks must be broken into actionable steps.
4. Steps must be concrete.
5. No more than 5 breakdown steps per task.
6. Do NOT add commentary outside the structure.`;

  const response = await ai.models.generateContent({
    model,
    contents: [{ parts: [{ text: rawText }] }],
    config: {
      systemInstruction,
    },
  });

  return response.text;
};

export const generateTodayPlan = async (
  tasks: string,
  availableTime: string,
  energyLevel: "Low" | "Medium" | "High",
  workHours?: string
) => {
  const model = "gemini-3.1-pro-preview";
  const systemInstruction = `You are ClearDay, a structured execution engine. Create a realistic today plan.

Planning Rules:
1. Anti-Overwhelm: Max 3 major tasks, Max 5 small tasks.
2. If time is insufficient, explicitly say: "This is not realistic. Here’s what fits today."
3. Energy Matching:
   - Low: Admin, small tasks, light organization.
   - Medium: Moderate work, calls, structured tasks.
   - High: Deep work, creative tasks, complex thinking.
4. Time Blocking: Use 45–60 min focus blocks, 5–15 min breaks. Be realistic.

Output Format (STRICT):
TODAY PLAN:

09:00–09:45 → Task
09:45–10:00 → Break
10:00–10:45 → Task
...

FOCUS NOTE:
One short sentence that reinforces execution clarity. No motivational speech. One sentence only.`;

  const prompt = `Task list:
${tasks}

Available time: ${availableTime}
Energy level: ${energyLevel}
${workHours ? `Work hours: ${workHours}` : ""}

Generate the plan.`;

  const response = await ai.models.generateContent({
    model,
    contents: [{ parts: [{ text: prompt }] }],
    config: {
      systemInstruction,
    },
  });

  return response.text;
};
