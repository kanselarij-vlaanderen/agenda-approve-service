# agenda-approve-service

Microservice providing capabilities to execute various actions related to the approval workflow for agendas.

every API call puts the server in "busy" mode.
Only 1 api call is processed at a time, any other api calls are refused and have to be retried.

## Getting started
### Add the service to a stack
Add the following snippet to your `docker-compose.yml`:

```yml
agenda-approval:
  image: kanselarij/agenda-approve-service
  environment:
    CACHE_CLEAR_TIMEOUT: 2000 # adds a timeout before sending a response, to give the cache time to clear.
    SERVER_BUSY_TIMEOUT: 5000 # keeps the server "busy" for the duration of the timeout after the API call response was sent. 
```

## Reference
### API


#### POST /agendas/:id/approve

Approve the design agenda and create a new design agenda.

#### POST /agendas/:id/close

Approve the design agenda and close the meeting.

#### POST /agendas/:id/reopen

Re-open the last approved agenda (and remove the design agenda if any)

#### DELETE /agendas/:id

Delete the latest agenda. If this agenda was the last on the meeting, also delete the meeting.

#### POST /meetings/:id/close

Remove the design agenda if present and close the meeting.

#### POST /meetings/:id/reopen

Re-open the meeting and create a new design agenda.


