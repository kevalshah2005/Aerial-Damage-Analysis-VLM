import { streamText, convertToModelMessages, tool, stepCountIs } from "ai"
import { bedrock } from "@ai-sdk/amazon-bedrock"
import { z } from "zod"
import { tavily } from "@tavily/core"
import fs from "fs"
import path from "path"
import {
  appendMessage,
  assertConversationOwnership,
  generateConversationTitleFromMessage,
  updateConversationMetadata,
  updateConversationTitle,
} from "@/lib/chat-store"
import { getAuthenticatedUserId } from "@/lib/auth-server"
import { buildChatDataContext } from "@/lib/chat-context"

export async function POST(req: Request) {
  try {
    const userId = await getAuthenticatedUserId(req)
    const { messages, conversationId } = await req.json()
    if (!conversationId || typeof conversationId !== "string") {
      return Response.json({ error: "conversationId is required" }, { status: 400 })
    }

    const conversation = await assertConversationOwnership(conversationId, userId)
    const modelId = process.env.BEDROCK_MODEL_ID
    if (!modelId) {
      throw new Error("Missing BEDROCK_MODEL_ID environment variable")
    }

    const latestUserMessage =
      messages
        .slice()
        .reverse()
        .find((message: { role: string }) => message.role === "user") ?? null
    const latestUserText =
      latestUserMessage?.parts
        ?.filter((part: { type: string }) => part.type === "text")
        .map((part: { text: string }) => part.text)
        .join("")
        .trim() ?? ""

    if (latestUserText) {
      await appendMessage({
        conversationId,
        userId,
        role: "user",
        content: latestUserText,
        modelId,
      })
      const now = new Date().toISOString()
      await updateConversationMetadata({
        conversationId,
        updatedAt: now,
        lastMessagePreview: latestUserText.slice(0, 180),
        incrementMessageCountBy: 1,
      })

      if (conversation.title === "New Chat") {
        await updateConversationTitle(
          conversationId,
          generateConversationTitleFromMessage(latestUserText)
        )
      }
    }

    const datasetContext = buildChatDataContext()

    const result = streamText({
      model: bedrock(modelId),
      system: `You are GeoView AI, a disaster-analysis assistant focused on the 2011 Joplin tornado. You also control an interactive map that the user is viewing.

Your primary job is to answer questions using this project's local Joplin context, including:
- Aerial pre/post-disaster imagery metadata and patch-level coverage
- Building damage labels and subtype counts from the local dataset summary
- Curated Joplin tornado reference notes (with source prioritization)

Map control rules:
- When the user asks to navigate, go to, show, find, zoom, or change the map — call the appropriate map tool.
- After calling a map tool, always write a brief confirmation in plain text (e.g. "Navigating to Joplin now." or "Pre-disaster layer is now visible.").
- You may call multiple map tools and respond with text in the same turn.
- Use fly_to for cities or specific points. Use fit_bounds for regions, states, or countries.
- For set_zoom: zoomed-out overview = 3-5, country = 5-7, state = 6-8, city = 10-12, neighborhood = 13-15.
- For set_base_layer: use "satellite" for imagery, "terrain" for topography, "dark" for a minimal dark style.
- For toggle_layer / set_layer_opacity / fit_to_dataset: only use when the user's question implies a dataset is loaded. Use layer="buildings" for ground-truth (human-annotated) damage, layer="predicted" for model-predicted damage.
- For place_marker: use when the user asks to mark, pin, or highlight a specific location.
- For clear_markers: use when the user asks to remove or clear pins/markers.
- For show_damage_path: show or hide the polynomial curve-of-best-fit representing the estimated tornado damage path. Use when the user asks to show, visualize, or hide the tornado track, damage path, or curve of best fit.
- For query_dataset: use when the user asks about specific patches, wants to know which areas were hardest hit, asks for rankings/breakdowns beyond the summary already in context, or wants geographic details. All results are from model predictions — always make clear you are reporting predicted damage, not ground truth.
- For web_search: use when the question requires current information, external sources, or general knowledge not covered by the local dataset context. Always cite the sources you used.

Behavior rules:
- Prioritize Joplin-specific answers over generic geospatial explanations.
- Ground responses in the provided local context whenever possible.
- Cite concrete values from the context (counts, percentages, timestamps, damage categories) when relevant.
- If the context does not contain enough evidence, say that clearly and ask for the exact missing input.
- Do not invent facts, sources, or statistics.
- When sources disagree, mention the discrepancy briefly and prefer official sources first (NWS/NOAA/FEMA/NIST), then secondary summaries.
- Keep answers concise and practical for damage assessment and decision support.

--- BEGIN LOCAL DISASTER CONTEXT ---
${datasetContext}
--- END LOCAL DISASTER CONTEXT ---

Provide clear, technically accurate responses in readable paragraphs. Keep responses focused and under 300 words unless the user asks for more detail.`,
      tools: {
        fly_to: tool({
          description: "Pan and zoom the map to a specific location. Use when the user asks to go to, navigate to, show, or find a place.",
          inputSchema: z.object({
            location: z.string().describe("Human-readable name of the location"),
            lat: z.number().describe("Latitude"),
            lng: z.number().describe("Longitude"),
            zoom: z.number().optional().describe("Zoom level 1-20. Cities: 10, states: 7, countries: 5, neighborhoods: 13."),
          }),
          execute: async (): Promise<{ ok: true }> => ({ ok: true }),
        }),
        fit_bounds: tool({
          description: "Fit the map view to a geographic bounding box. Use for regions, states, or countries where a single point and zoom is insufficient.",
          inputSchema: z.object({
            north: z.number().describe("North latitude bound"),
            south: z.number().describe("South latitude bound"),
            east: z.number().describe("East longitude bound"),
            west: z.number().describe("West longitude bound"),
          }),
          execute: async (): Promise<{ ok: true }> => ({ ok: true }),
        }),
        set_zoom: tool({
          description: "Change the map zoom level without moving the center.",
          inputSchema: z.object({
            zoom: z.number().describe("Zoom level 1-20"),
          }),
          execute: async (): Promise<{ ok: true }> => ({ ok: true }),
        }),
        set_base_layer: tool({
          description: "Switch the base map style. satellite = aerial imagery, terrain = topographic, dark = minimal dark.",
          inputSchema: z.object({
            layer: z.enum(["satellite", "terrain", "dark"]),
          }),
          execute: async (): Promise<{ ok: true }> => ({ ok: true }),
        }),
        toggle_layer: tool({
          description: "Show or hide a dataset overlay layer. Only use when a dataset is loaded. pre = pre-disaster imagery, post = post-disaster imagery, buildings = ground-truth building damage polygons (human-annotated), predicted = model-predicted building damage polygons.",
          inputSchema: z.object({
            layer: z.enum(["pre", "post", "buildings", "predicted"]),
            visible: z.boolean().optional().describe("true to show, false to hide. Omit to toggle current state."),
          }),
          execute: async (): Promise<{ ok: true }> => ({ ok: true }),
        }),
        set_layer_opacity: tool({
          description: "Set the opacity of a dataset overlay layer (0 = invisible, 1 = fully opaque). Only use when a dataset is loaded.",
          inputSchema: z.object({
            layer: z.enum(["pre", "post", "buildings", "predicted"]),
            opacity: z.number().min(0).max(1).describe("Opacity from 0.0 (invisible) to 1.0 (fully opaque)"),
          }),
          execute: async (): Promise<{ ok: true }> => ({ ok: true }),
        }),
        place_marker: tool({
          description: "Place a pin marker on the map at a specific location.",
          inputSchema: z.object({
            lat: z.number().describe("Latitude"),
            lng: z.number().describe("Longitude"),
            label: z.string().optional().describe("Optional text label for the marker"),
          }),
          execute: async (): Promise<{ ok: true }> => ({ ok: true }),
        }),
        clear_markers: tool({
          description: "Remove all markers that have been placed on the map.",
          inputSchema: z.object({}),
          execute: async (): Promise<{ ok: true }> => ({ ok: true }),
        }),
        fit_to_dataset: tool({
          description: "Zoom the map to fit the loaded dataset area. Only use when a dataset is loaded.",
          inputSchema: z.object({}),
          execute: async (): Promise<{ ok: true }> => ({ ok: true }),
        }),
        show_damage_path: tool({
          description: "Show or hide a polynomial curve-of-best-fit representing the estimated tornado damage path, fitted to the spatial distribution of severe building damage across the dataset. Use when the user asks to show/hide the tornado track, damage path, or curve of best fit.",
          inputSchema: z.object({
            visible: z.boolean().describe("true to show the damage path curve, false to hide it"),
          }),
          execute: async (): Promise<{ ok: true }> => ({ ok: true }),
        }),
        query_dataset: tool({
          description: "Query the local Joplin damage dataset for specific patch-level information. Use when the user asks about specific areas, top damaged patches, geographic breakdown, or wants data beyond the summary already provided.",
          inputSchema: z.object({
            query_type: z.enum(["top_damaged", "patch_detail", "bounds_search"]).describe(
              "top_damaged: return patches sorted by damage type. patch_detail: get full damage breakdown for a specific patch ID. bounds_search: find patches within a lat/lng area."
            ),
            damage_type: z.enum(["destroyed", "major-damage", "minor-damage", "no-damage"]).optional().describe("For top_damaged queries"),
            patch_id: z.string().optional().describe("For patch_detail queries"),
            limit: z.number().optional().describe("Max results to return (default 10)"),
            lat_min: z.number().optional(),
            lat_max: z.number().optional(),
            lng_min: z.number().optional(),
            lng_max: z.number().optional(),
          }),
          execute: async ({ query_type, damage_type, patch_id, limit, lat_min, lat_max, lng_min, lng_max }) => {
            try {
              const summariesPath = path.join(process.cwd(), "content", "chat-context", "predicted_patch_summaries.json")
              const dataSource = "predicted"
              if (!fs.existsSync(summariesPath)) return { error: "Predicted patch summaries not available. Run the pipeline to generate predictions." }
              type Patch = { id: string; bounds: [[number,number],[number,number]]; buildingCount: number; damage: Record<string, number> }
              const patches: Patch[] = JSON.parse(fs.readFileSync(summariesPath, "utf-8"))

              if (query_type === "patch_detail" && patch_id) {
                const patch = patches.find(p => p.id === patch_id)
                if (!patch) return { error: `Patch ${patch_id} not found.` }
                const total = patch.buildingCount || 1
                const pct = (n: number) => `${((n / total) * 100).toFixed(1)}%`
                const d = patch.damage
                return {
                  data_source: dataSource,
                  id: patch.id,
                  buildingCount: patch.buildingCount,
                  bounds: patch.bounds,
                  center: [(patch.bounds[0][0] + patch.bounds[1][0]) / 2, (patch.bounds[0][1] + patch.bounds[1][1]) / 2],
                  damage: d,
                  percentages: {
                    destroyed: pct(d["destroyed"] ?? 0),
                    "major-damage": pct(d["major-damage"] ?? 0),
                    "minor-damage": pct(d["minor-damage"] ?? 0),
                    "no-damage": pct(d["no-damage"] ?? 0),
                  },
                }
              }

              if (query_type === "bounds_search") {
                const filtered = patches.filter(p => {
                  const centerLat = (p.bounds[0][0] + p.bounds[1][0]) / 2
                  const centerLng = (p.bounds[0][1] + p.bounds[1][1]) / 2
                  return (
                    (lat_min == null || centerLat >= lat_min) &&
                    (lat_max == null || centerLat <= lat_max) &&
                    (lng_min == null || centerLng >= lng_min) &&
                    (lng_max == null || centerLng <= lng_max)
                  )
                })
                return { data_source: dataSource, count: filtered.length, patches: filtered.slice(0, limit ?? 10).map(p => ({ id: p.id, buildingCount: p.buildingCount, damage: p.damage })) }
              }

              // top_damaged
              const sortKey = damage_type ?? "destroyed"
              const sorted = [...patches].sort((a, b) => (b.damage[sortKey] ?? 0) - (a.damage[sortKey] ?? 0)).slice(0, limit ?? 10)
              return {
                data_source: dataSource,
                sorted_by: sortKey,
                results: sorted.map(p => ({
                  id: p.id,
                  center: [(p.bounds[0][0] + p.bounds[1][0]) / 2, (p.bounds[0][1] + p.bounds[1][1]) / 2],
                  buildingCount: p.buildingCount,
                  [sortKey]: p.damage[sortKey] ?? 0,
                  damage: p.damage,
                })),
              }
            } catch (e) {
              return { error: e instanceof Error ? e.message : "Query failed" }
            }
          },
        }),
        web_search: tool({
          description: "Search the web for current information. Use when the user asks about something not covered by the local dataset context, or wants recent news, general facts, or external sources.",
          inputSchema: z.object({
            query: z.string().describe("The search query"),
          }),
          execute: async ({ query }) => {
            const apiKey = process.env.TAVILY_API_KEY
            if (!apiKey) return { error: "Web search is not configured." }
            try {
              const client = tavily({ apiKey })
              const res = await client.search(query, { maxResults: 5, searchDepth: "basic" })
              return {
                results: res.results.map((r) => ({
                  title: r.title,
                  url: r.url,
                  content: r.content,
                })),
              }
            } catch (e) {
              return { error: e instanceof Error ? e.message : "Search failed" }
            }
          },
        }),
      },
      stopWhen: stepCountIs(3),
      messages: await convertToModelMessages(messages),
      onFinish: async ({ text, steps }) => {
        const assistantText = text.trim()
        if (!assistantText) return
        const now = new Date().toISOString()
        // toolCalls on the event is only the final step — flatten all steps to capture
        // tool calls from intermediate steps (step 1 tools, step 2 text is typical)
        const allToolCalls = (steps ?? []).flatMap((s) => s.toolCalls ?? [])
        const storedToolCalls = allToolCalls.map((tc) => ({
          toolCallId: tc.toolCallId,
          toolName: tc.toolName,
          input: (tc.input ?? {}) as Record<string, unknown>,
        }))
        await appendMessage({
          conversationId,
          userId,
          role: "assistant",
          content: assistantText,
          modelId,
          ...(storedToolCalls.length ? { toolCalls: storedToolCalls } : {}),
        })
        await updateConversationMetadata({
          conversationId,
          updatedAt: now,
          lastMessagePreview: assistantText.slice(0, 180),
          incrementMessageCountBy: 1,
        })
      },
    })

    return result.toUIMessageStreamResponse()
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed"
    if (message.includes("Authorization") || message.includes("token")) {
      return Response.json({ error: "Unauthorized" }, { status: 401 })
    }
    if (message === "Conversation not found") {
      return Response.json({ error: message }, { status: 404 })
    }
    return Response.json({ error: message }, { status: 400 })
  }
}
