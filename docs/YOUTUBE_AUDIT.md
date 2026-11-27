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
| Endpoints | `playlists.insert`, `playlistItems.list`, `playlistItems.insert`, `playlistItems.update`, `playlistItems.delete` |
| Quota asked for | 40,000 units a day |

The legal name, the address and the contact email are on the form and stay out of this repo.

## Description of the work, as sent

> CrateSync is a music library tool that I built and run for my own use. It reads the audio files on my computer and in my Google Drive and lets me arrange them into playlists. I link each song to its video on YouTube by pasting the video's link, and CrateSync opens a YouTube Music search for the song to help me find it.
>
> CrateSync uses YouTube API Services for one feature, Push to YouTube. When I click that button on a playlist, CrateSync creates a private playlist on my own YouTube account, or updates the one it created before, so that YouTube Music holds the same songs in the same order as the playlist in CrateSync.
>
> A push makes five kinds of call to the YouTube Data API. playlists.insert creates the private playlist the first time. playlistItems.list reads what the playlist holds. playlistItems.insert adds the linked videos the playlist lacks, each at its place. playlistItems.update moves a video that is out of order. playlistItems.delete removes a video, and only one that an earlier push from CrateSync added. A video I added on YouTube myself is never removed.
>
> CrateSync does not call search.list. It does not upload, download or store video or audio from YouTube, and it reads no watch history, subscriptions, comments or channel data. It keeps only the playlist ID and the video IDs, in my browser's storage and, when Drive sync is on, in a library file in my own Google Drive. It reads the playlist again on every push. The browser calls the API directly. The OAuth access token stays in the page's memory, is dropped after 50 minutes and is never written to storage. When a song has no audio file on my device, CrateSync can play its video in the standard YouTube embedded player.
>
> Before every push a review window shows how many songs the push will add, remove and move. It says the push uses YouTube API Services and links the YouTube Terms of Service, CrateSync's terms and CrateSync's privacy policy. The privacy policy links the Google Privacy Policy and the Google page where access can be revoked.
>
> CrateSync has no ads, no payments and no analytics. The value to me as a YouTube Music listener is that the playlists I build from my own music collection appear in YouTube Music on all my devices without my adding hundreds of songs by hand. The source code is public at https://github.com/BaruchEric/YouTubemusicplaylist-.

## Quota justification, as sent

> CrateSync has one user, me. Every playlist change is one write that costs 50 units: playlistItems.insert, playlistItems.update or playlistItems.delete. Reading a playlist costs 1 unit per 50 entries. My music library holds 2,568 songs. Sending it to YouTube the first time takes about 2,568 inserts, which is 128,400 units. At the default 10,000 units a push stops after 200 songs, so the first sync takes 13 days, and re-ordering one 200-song playlist can use a whole day. With 40,000 units a day the first sync takes 4 days and a day's upkeep fits. That is at most 800 writes on a day. After the first sync I expect fewer than 100 requests on most days. CrateSync counts the writes before each push. When a push needs more than one day's quota the review window says so, the push stops when YouTube reports that the quota is used up, and the next push carries on from there. CrateSync does not call search.list or videos.insert.

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
| User flow diagram | `user-flow-diagram.png` | [`diagrams/push-user-flow.mmd`](diagrams/push-user-flow.mmd), rendered |
| Other supporting materials | `screencast-push-to-youtube.mp4` | A recording of two pushes, a removal and an addition, then the screenshot of the playlist on YouTube |

The screenshots and the recording show a signed-in account, so they are kept outside the repo. The two diagrams are in [`diagrams/`](diagrams/). Render one with `bunx --bun @mermaid-js/mermaid-cli -i X.mmd -o X.png -b white -s 2 -q`.

## Where the evidence falls short of what the form asks

- The form asks for the browser address bar in web screenshots. These were taken from inside the page and have none.
- There is no screenshot of Google's consent screen. Google's window opens outside the tab and closes by itself once access is given.
- The recording ends on a still screenshot of the playlist on YouTube. It does not show the browser going there.

## If Google grants the quota

`YOUTUBE_DAILY_QUOTA_UNITS` in [`src/utils/youtubePush.ts`](../src/utils/youtubePush.ts) is 10,000. Set it to the granted number, or the review window keeps counting days against the old limit.
