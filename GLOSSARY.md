# Glossary

**Client**
A registered user's live connection to the chat server. Identified by the user's unique username.
_Avoid_: session, socket, node

**Username**
The unique name a user registers with. It is the name every other Client sees.
_Avoid_: nickname, handle, display name

**Online**
A user with at least one live Client connection. Offline users still exist and can receive messages.

**Chat Room**
A conversation space with its own message window and chat box. Either a Private Room or a Group.
_Avoid_: channel, thread

**Private Room**
A Chat Room for exactly two users, created the first time either one messages the other. Only those two see its messages.
_Avoid_: DM, direct chat

**Group**
A Chat Room with a unique name, created by one user (the Creator) who is initially its only Member. Visible to everyone in the Group list, with its Member list.
_Avoid_: channel, team

**Creator**
The user who created a Group. Only the Creator can delete it, and the Creator cannot leave it.

**Member**
A user who belongs to a Group. Users become Members only by joining themselves, never by being added. A new Member sees the Group's full history.

**Join / Leave**
Join: a user chooses to become a Member of a Group. Leave: a Member other than the Creator stops being a Member, and may Join again later.

**Message**
A text-only entry in a Chat Room, with a sender and a timestamp. Messages cannot be edited or deleted individually.

**Unread**
A Message in a Chat Room that arrived, from someone else, after that user's read marker for the room. The marker advances while the user is viewing the room.

**Unread Summary**
An AI-written digest of a user's Unread Messages in one Chat Room.

**Translation**
An AI-written rendering of one Message in the user's chosen target language, shown to that user only and not stored.

**Transcription**
Text produced from a user's recorded speech, placed in the chat box for editing before it is sent.

**Speech (TTS)**
Audio read aloud from one Message's text.
