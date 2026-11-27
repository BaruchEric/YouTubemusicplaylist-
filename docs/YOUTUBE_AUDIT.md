# YouTube quota request

This is what Google was told about CrateSync on the [Audit and Quota Extension Form](https://support.google.com/youtube/contact/yt_api_form). The form's attestations include telling YouTube in writing before the use of the API changes, so a change to what CrateSync calls or keeps goes here and to Google first.

Status on 26 November 2026: sections 1 to 6 are filled in. The attestations in section 7 and the Submit button are the applicant's to tick and press. Put the date here once it is sent.

## Answers

| Field | Answer |
| --- | --- |
| Request | Compliance audit for additional quota |
| Applying as | An individual. Organization and parent company are "self", as the form asks |
| Website | https://barucheric.github.io/YouTubemusicplaylist-/ |
| Category | Technology/Software Development |
| Organization type | Independent Developer/Sole Proprietor |
| Target audience | Internal Users |
| Monetization | Free service |
| Google representative | None |
| API client name | CrateSync |
| Primary access URL | https://music.beric.ca/ |
| Privacy policy | https://barucheric.github.io/YouTubemusicplaylist-/privacy.html |
| Terms of service | https://barucheric.github.io/YouTubemusicplaylist-/terms.html |
| Publicly accessible | No. One user behind a login, and no demo account |
| Google Cloud project number | 1051273001982 |
| Use case | Video Uploading & Account Management, the category for managing playlists in bulk |
| Sign-in with Google | Yes |
| Expected volume | Fewer than 1,000 requests per day |
| Endpoints | `search.list`, `videos.list`, `playlists.insert`, `playlistItems.list`, `playlistItems.insert`, `playlistItems.update`, `playlistItems.delete` |
| Quota asked for | 40,000 units a day |

The legal name, the address and the contact email are on the form and stay out of this repo.

## Description of the work, as sent

> CrateSync is a music library tool that I built and run for my own use. It reads the audio files on my computer and in my Google Drive and lets me arrange them into playlists. Each song is linked to its video on YouTube, and a playlist is then sent to my own YouTube account, so that YouTube Music holds the same songs in the same order as the playlist in CrateSync.
>
> CrateSync uses YouTube API Services for two features.
>
> Match YouTube finds the video for a song. It can search: search.list is called once per song with the song's artist and title, limited to music videos, and returns up to five results, of which CrateSync reads the video ID, the title and the channel name. Or I give it the link of one of my own playlists, my liked videos included, and it reads that playlist with playlistItems.list. CrateSync compares titles and artists and shows me each song next to the video it proposes, with a link to the video. Nothing is saved until I review the list and click Apply.
>
> Push to YouTube sends a playlist. playlists.insert creates a private playlist the first time. playlistItems.list reads what the playlist holds. playlistItems.insert adds the linked videos the playlist lacks, each at its place. playlistItems.update moves a video that is out of order. playlistItems.delete removes a video, and only one that an earlier push from CrateSync added. A video I added on YouTube myself is never removed.
>
> Of the API data, CrateSync stores the video ID of each match I applied, the ID of the playlist it pushes to and the IDs of the videos it added to it. They sit in my browser's storage and, when Drive sync is on, in a library file in my own Google Drive. Titles and channel names are shown for the review and then dropped. A stored video ID is refreshed after 30 days: at the start of the next push or lookup CrateSync calls videos.list with the IDs saved more than 30 days ago and deletes the match of a song whose video YouTube no longer has. The playlist is read again on every push. Deleting a song or clearing its match deletes the stored ID.
>
> CrateSync does not upload, download or store video or audio from YouTube, and it reads no watch history, subscriptions, comments or channel data. The browser calls the API directly. The OAuth access token stays in the page's memory, is dropped after 50 minutes and is never written to storage. When a song has no audio file on my device, CrateSync can play its video in the standard YouTube embedded player.
>
> Before a search the window shows how many songs it will search and what that costs in quota. Before every push a review window shows how many songs the push will add, remove and move. Both say that CrateSync uses YouTube API Services and link the YouTube Terms of Service, CrateSync's terms and CrateSync's privacy policy. The privacy policy links the Google Privacy Policy and the Google page where access can be revoked.
>
> CrateSync has no ads, no payments and no analytics. The value to me as a YouTube Music listener is that the playlists I build from my own music collection appear in YouTube Music on all my devices without my finding and adding thousands of songs by hand. The source code is public at https://github.com/BaruchEric/YouTubemusicplaylist-.

## Quota justification, as sent

> CrateSync has one user, me. My music library holds 2,568 songs and none is linked to a video yet. Finding the videos takes one search.list call per song at 100 units, 256,800 units in all. Sending the songs to YouTube takes one playlistItems.insert per song at 50 units, 128,400 units. Together the first sync costs 385,200 units. At the default 10,000 units a day holds 100 searches or 200 inserts, so the first sync takes 39 days. With 40,000 units a day it takes 10 days, at no more than 400 searches or 800 writes on a day. After the first sync I expect fewer than 100 requests on most days, for new songs and for re-ordering a playlist. CrateSync keeps its own use down. A search run is capped at one day's quota and shows its cost before it starts. A song searched in the last 30 days is not searched again. Reading one of my playlists matches many songs for 1 unit per 50 videos. The 30-day refresh of stored video IDs costs 1 unit per 50 videos. A push counts its writes before it starts, and both a search and a push stop when YouTube reports that the quota is used up. CrateSync does not call videos.insert.

## Access note, as sent

> CrateSync is a personal tool with one user, served from my own server behind a login. It has no demo account. A screen recording of a push, followed by a screenshot of the playlist on YouTube, is attached under Other Supporting Materials in Section 6. The source code is public at https://github.com/BaruchEric/YouTubemusicplaylist-.

## Evidence attached

| Form field | File | What it shows |
| --- | --- | --- |
| Privacy policy screenshots | `06-privacy-policy-full-page.png` | The whole of `privacy.html`, with the YouTube section, the Google Privacy Policy link and the deletion section |
| Homepage screenshot | `01-home-with-privacy-and-terms-links.jpg` | The dashboard with the Privacy and Terms links at the foot of the sidebar |
| Terms of service | `07-terms-of-use-full-page.png` | The whole of `terms.html` |
| Conditional evidence | `09-push-to-youtube-screens.png` | The review window, the finished window, the playlist reading In sync and the playlist on YouTube |
| Architecture diagram | `architecture-diagram.png` | [`diagrams/architecture.mmd`](diagrams/architecture.mmd), rendered |
| User flow diagram | `user-flow-diagram.png` | [`diagrams/push-user-flow.mmd`](diagrams/push-user-flow.mmd) above [`diagrams/match-user-flow.mmd`](diagrams/match-user-flow.mmd), rendered and joined into one image |
| Other supporting materials | `screencast-push-to-youtube.mp4` | A recording of two pushes, a removal and an addition, then the screenshot of the playlist on YouTube |

The screenshots and the recording show a signed-in account, so they are kept outside the repo. The three diagrams are in [`diagrams/`](diagrams/). Render one with `bunx --bun @mermaid-js/mermaid-cli -i X.mmd -o X.png -b white -s 2 -q`.

## Where the evidence falls short of what the form asks

- The form asks for the browser address bar in web screenshots. These were taken from inside the page and have none.
- There is no screenshot of Google's consent screen. Google's window opens outside the tab and closes by itself once access is given.
- The recording ends on a still screenshot of the playlist on YouTube. It does not show the browser going there.

## If Google grants the quota

`YOUTUBE_DAILY_QUOTA_UNITS` in [`src/utils/youtubePush.ts`](../src/utils/youtubePush.ts) is 10,000. Set it to the granted number, or the push review window keeps counting days against the old limit and Match YouTube keeps capping a search run at 100 songs.
