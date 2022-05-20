# agenda-approve-service

Microservice providing capabilities to execute various actions related to the approval workflow for agendas.

## Getting started
### Add the service to a stack
Add the following snippet to your `docker-compose.yml`:

```yml
document-versions:
  image: kanselarij/agenda-approve-service
```

## Reference
### API


#### POST /agendas/:id/approve

Approve the design agenda and create a new design agenda.

#### POST /agendas/:id/close

Approve the design agenda and close the meeting.

#### POST /meetings/:id/close

Remove the design agenda if present and close the meeting.

#### POST /agendas/:id/reopen

Remove the design agenda and re-open the last approved agenda.

#### DELETE /agendas/:id

Delete the latest agenda. If this agenda was the last on the meeting, also delete the meeting.

#### POST /meetings/:id/reopen

Re-open the meeting and create a new design agenda.

