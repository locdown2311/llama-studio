---
name: Video editor (cuts and editing)
description: Method for editing the project's recordings with the video tools (video_captions, video_find, video_peaks, video_look, video_edit, video_thumbnail). Says how to find the moments and assemble the video for each situation: live-stream cut, gameplay highlights, gunfights or combat, funny moments, react, tutorial, conversation or podcast, montage to music and horizontal recap. Use whenever the request is to edit, cut or summarize a video that is in public/.
version: 2
---

# Video editor

You edit recordings that are in public/ by building an edit list with video_edit. The studio turns the list into a Remotion video; you do not write React.

Follow the 7 stages in order. In stage 3 pick ONE recipe (or two, if the request mixes them) and use its parameters.

## Rules that always apply

1. **Time:** every from/to is in SECONDS of the original file (175.5) or text "2:55.5". Never 2.55 to mean 2:55.
   - Exception: at in texts and punch is in seconds from the start of the clip, not of the file.
2. **Format:**
   - edl.format always filled in.
   - Shorts, Reels and TikTok: "9:16". Regular YouTube: "16:9". Instagram feed: "4:5" or "1:1".
   - It is the aspect ratio of the FINAL video, not of the recording: a 16:9 recording becomes 9:16 if the target is Shorts.
   - If the user does not say, ask for the target or use 9:16.
3. **Duration:**
   - Add up the clips BEFORE assembling.
   - Transitions other than "cut" overlap the clips and shorten the total (0.5 s each). speed 1.25 shortens the clip by 20%.
   - After assembling, check duration and size in the video_edit reply. If they do not match the request, fix and call again.
4. **Never assume what is on screen from the speech.**
   - Confirm with video_look before choosing a clip.
   - Sounds that are not speech (gunshots, explosions, shouts, laughs) do not show in the captions. video_peaks finds where the sound rises, but does not say what it is: confirm each peak with video_look.
5. **One moment per clip, cut in the right place:**
   - Start a little before the action (0.5 to 2 s) and end right after the reaction.
   - Do not cut in the middle of a sentence or of an exchange of fire.
6. **cutSilences removes everything without speech.**
   - Use it only when speech is the content (tutorial, conversation, talking live stream).
   - In gameplay and action it deletes exactly the action.
   - With cutSilences, put the at of texts and punch on a moment with speech: anything that falls in a removed pause is dropped.
7. If the user asked to see the plan first, show it and WAIT. If not, show it and assemble right after.

## 1. Understand the request

Before anything, settle these, inferring from the request whenever possible:
- **File:** use list_directory on public/ if the name is not given.
- **Target and format:** Shorts, Reels, TikTok, YouTube or feed.
- **Target duration:** if not given, highlight Shorts 30–60 s, live-stream cut 40–120 s, YouTube 3–10 min.
- **Type of content and what the user wants to highlight:** picks the recipe in stage 3.
- **How many videos:** a single cut or several.

## 2. Inventory

- video_look on the whole file with 24 frames: structure, menus, idle parts, whether there is a facecam, where the action sits on screen.
- video_captions (language of the video, model "small"). Skip if public/captions/<name>.json already exists.
  - Empty caption or only noise: the video has no speech; go by the frames only.
  - With speech: video_find without query, on a piece, shows the style; with query, it finds the reactions.
- video_peaks on the whole file (a few seconds): the loud stretches, how many peaks each has and the busiest minutes. A great starting point for action, scares and laughs.
- **Long video** (over 5 min) where the moment is visual and silent (video_peaks does not help): sweep it in 3-minute blocks (video_look from/to, 24 frames each, one frame every ~7 s). Skip blocks that are menus or a still screen.

## 3. Choose the recipe

| Situation | Signs | Recipe |
|---|---|---|
| Live stream or video with the streamer talking and reacting | frequent speech, facecam, laughs, shouts | A. Live cut |
| Gameplay where the action matters more than speech | little speech, lots of action on screen | B. Highlights |
| Gameplay with combat | weapons, enemies, health bars, kills | C. Gunfight and combat |
| Fails, silly deaths, bugs, jump scares | laughs, "lol", character falling | D. Funny |
| Two videos: the person reacting and the content | two files in public/ | E. React |
| Explanation, lesson, tutorial | continuous speech, still screen or demo | F. Tutorial |
| Conversation, podcast, interview, vlog | talking faces, little action | G. Conversation |
| Editing to a song's rhythm | audio file in public/ | H. Music |
| Long horizontal recap | target YouTube 16:9 | I. Recap |

## 4. Find the moments (by recipe)

### A. Live cut
- **Goal:** ONE moment told from start to end (context, climax, reaction). 40 to 120 s.
- **Search:** video_find with a query of the streamer's exclamations (e.g. "no way|oh my god|what|lol|help|i died|run|look at this"). For each hit, video_find from 40 s before and to 20 s after, to read the context.
- **Confirm:** video_look on the clip with 12 frames.
- **Score 1 to 10 by:** strong reaction, closed story, understandable without the live's context.

### B. Gameplay highlights
- **Goal:** several short plays, in rising order of intensity. 30 to 60 s.
- **Search:** video_peaks (crashes, falls, shouts) and inventory in blocks looking for chases, near deaths, records, falls, hard parts beaten. With speech, add recipe A's query.
- **For each clip, note:** second of impact and horizontal position of the action (becomes focusX).

### C. Gunfight and combat
- **Goal:** firefights, kills, explosions, comebacks. 45 to 60 s for Shorts.
- **Signs on screen:**
  - muzzle flash, bullet tracers, sparks;
  - enemies shooting or falling, explosions;
  - health bar dropping, red screen;
  - ammo or reload;
  - hit or kill marker.
- **Search:**
  - video_peaks first: stretches with several peaks in a row are usually firefights. Confirm each with video_look (from 3 s before, to 3 s after, 12 to 16 frames).
  - If video_peaks finds little (quiet game, loud music), sweep in blocks with video_look.
  - Group signs less than 10 s apart into one clip.
  - With speech, video_find with a query like "shoot|shot|ammo|reload|killed|kill|dead|headshot|get him|watch out|behind|exploded|grenade" and confirm each hit with video_look.
- **Priority:** multi-kills > near death with comeback > explosion > long firefight.
- A chase without shooting does not count, unless it leads into a gunfight.

### D. Funny
- **Goal:** short fails and reactions; the laugh comes from timing.
- **Search:** query "lol|haha|no way|what was that|help|bug|i died|ouch". On screen: character falling, glitching, dying in a silly way. video_peaks catches the laughs and shouts.
- The clip runs to the end of the laugh, not one second more.

### E. React
- **Needs two files:** the facecam (cam) and the content. The cam starts in sync: cam.from = where the cam is when the clip starts.
- **Facecam baked into the same recording (the usual case in live streams):**
  - Look at a frame with video_look and estimate the facecam region as fractions of the frame (x, y of the top-left corner; w, h). E.g. bottom-right corner ≈ {"x":0.74,"y":0.64,"w":0.26,"h":0.36}.
  - layout "react", cam without src and with crop. The studio uses the same file, in sync and without double audio.
  - So the game below does not repeat the facecam, pass crop on the clip with the game area (e.g. {"x":0,"y":0,"w":0.72,"h":1}), or leave it if it does not get in the way.
  - split 0.35 to 0.45 (the cam on top takes that fraction of the height).
- **Search:** the person's reactions (recipe A on the cam file, with captions.source "cam").

### F. Tutorial
- **Goal:** a tight explanation without pauses, hesitations and repeats.
- **Search:** video_find without query, in pieces, to map the topics. Cut "uh...", restarts and off-topic parts.
- Keep the order of the explanation.

### G. Conversation or podcast
- **Goal:** the best idea or story in the conversation, understandable on its own.
- **Search:** video_find in pieces. Look for punchlines, strong opinions, stories with a start and end, good questions with a short answer.
- Prefer one whole answer over several halves.

### H. Music
- **Goal:** cuts on the song's beat.
- Clips equal to or multiples of the beat (e.g. 120 BPM = 0.5 s per beat; clips of 2 or 4 s). The best visuals land on the drops.
- music.src is the file in public/; volume 0.6 to 1. Lower the clips' audio (volume 0 to 0.2).

### I. Horizontal recap (YouTube)
- **Goal:** the video's story in order, without the idle parts. format "16:9".
- **Search:** inventory and sweep to mark menus, loading, waiting and repeats; those parts go.
- Long clips (10 to 60 s). "fade" transitions between parts or stages.

## 5. Plan

Show the user one line per clip with: start and end in the file (seconds), duration, what happens, focusX and layout. Then the total.

Default structure for short videos:
- **Hook (1 to 2 s, or up to 3 s for speech):** the strongest instant, as a preview. That moment comes back, whole, later.
- **Build-up:** the moments in rising order of intensity (recipes B, C, D) or the moment's context (A, G).
- **Climax and ending:** the best moment or the reaction, ending sharp. Optional: text "PART 2?" or a short joke.

## 6. Assemble with video_edit

### Parameters by recipe

| Recipe | layout | cutSilences | captions | clips | transitions | effects |
|---|---|---|---|---|---|---|
| A. Live | full (or fit) | yes (minSilence 0.4) | tiktok, center | 1 to 3 long | cut | punch at the climax and the reaction |
| B. Highlights | full | no | tiktok if there is speech; otherwise none | 2 to 6 s each | cut; slide or zoom on up to 2 stage changes | punch at impact; speed 1.25 on travel |
| C. Gunfight | full | no | as B | 3 to 8 s each | cut; zoom on up to 2 comebacks | punch on each kill or explosion (dur 0.4); no speed in firefights |
| D. Funny | full | no | tiktok | 2 to 8 s | cut | punch at the fail; short reaction text |
| E. React | react (split 0.4 to 0.5) | yes, if the cam's speech matters | tiktok, source "cam" | long | cut | punch at the reaction |
| F. Tutorial | fit, or full on the important area | yes (minSilence 0.5) | line, bottom | long | cut or fade | slow zoom 1.1 on demos |
| G. Conversation | full on the face (focusX) | yes (minSilence 0.5) | tiktok, center | 1 to 3 long | cut | punch on strong lines |
| H. Music | full | no | none | on the beat | cut (or short fade) | punch on strong beats; optional filter |
| I. Recap | fit/full in 16:9 | only in talking parts | line or none | 10 to 60 s | fade 0.5 between parts | — |

### Layout and crop (9:16 from a 16:9 recording)

- **full:** fills the screen by cropping; only about 1/3 of the width shows.
  - focusX = horizontal center of the crop (0 left, 0.5 middle, 1 right). Near the edge, the crop stops at the frame's limit.
  - focusX "auto": the crop follows the motion through the clip (good for a character moving across the screen). Use it when the action changes sides; on a still scene or a moving camera it stays in the middle.
  - Without "auto", if the action moves sides, split the clip into parts with different focusX.
- **crop:** uses only one region of the recording (0..1 fractions), e.g. to remove the facecam or a UI bar.
- **fit:** the whole recording in a band in the middle, with a blurred background. Use it when cropping would lose something essential (two characters on opposite sides, important UI).
- Avoid switching between full and fit every clip: the image keeps jumping.

### Texts and emphasis

- **texts:** up to 5 words, style "label", pos "top" (captions sit in center or bottom), dur 2 to 3 s.
  - One on the hook (curiosity without spoilers) and, optionally, one at the end.
  - Do not cover the action.
- **punch:** scale 1.15 to 1.25, dur 0.4 to 0.6, at the instant of impact. At most 1 every 2 s.
- **zoom:** slow push-in (1.05 to 1.15) for long still clips.
- **speed:** 1.25 to 1.5 only on travel without action. Speeding up speech or a firefight ruins the sound.
- **overlays:** emoji (😂 on a fail, 💀 on a death, 😱 on a scare), image (meme or logo from public/), arrow (points at something: x/y where it sits, angle where it points) and circle (highlights a spot). x/y = center on the final screen (0..1). Use sparingly: 1 or 2 per clip, only at the right moment, dur 1 to 2 s.

### After calling video_edit

- Check in the reply:
  - size (1080x1920 for 9:16);
  - duration within the target;
  - the test note.
- If it reports an error or a wrong duration, fix the list and call again with the same name. It replaces the previous one.
- For several cuts, one name per cut (Cut1, Cut2...). The user renders them all at once with "Render all" on the Videos page.

## 7. Check and deliver

- **To the user:**
  - final duration;
  - list of clips (seconds of the file, layout, focusX);
  - what to check in the preview (hook, crops, captions).
- **When they render:** video_look with file "out/<Name>" and 16 frames. Check:
  - right format, no unwanted bands;
  - action inside the crop;
  - captions in sync;
  - text not covering the action;
  - strong hook in the first second;
  - ending without dead time.
- Suggest concrete fixes: which clip, which seconds, which parameter.
- **Thumbnail, if asked:** video_thumbnail with the most expressive frame (a face reacting or the peak of the action, found with video_look), text of up to 4 words and, if it helps, an emoji or arrow. Same format as the cut (9:16 for Shorts, 16:9 for YouTube). Check the image that comes back.
- **For posting, if asked:** title up to 60 characters (curiosity, no spoilers), a one-line description, 5 hashtags. Research the hashtags on the web if available; otherwise say they are suggestions.
