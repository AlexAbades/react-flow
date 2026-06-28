# Write-up

When working on a new project, such as this one, I like to understand what I'll be working with. My first hour of the project is getting familiar with the project, reading the Readme, the comments of the files, some functions and getting familiar with ReactFlow; its functions, the internal state, and how renders different components related to the project.
Realize that I still have a lot to learn about ReactFLow and probably React states.

## How far did I get?

- [X] Challenge 1 — edges snap to the shape outline
- [ ] Challenge 2 — endpoints are grabbable and render above the node

## Challenge 1 — snapping to the outline

How did you approach it? What does your intersection logic do for each shape?
If you didn't finish, what did you try and where did it break down?

- First thoughts before reading the docs was to just change the divs shape (never thought I will need to look into this). 
The problem that I came to realize after reading the project is that we need to keep the (side, pct) of the edge, and that is not possible if we change the shape of the div as we will have rafactor to many things, we will no longer have only four sides, and the intersection logic will be more complex.
- Then I looked on the formulas the ReadMe pointet out and also what claude suggested. The idea will be to "materialize" the edges in the closest point of the shape, and then use the intersection logic to find the closest point on the shape outline. This requeries that we have the shapes defined in a way that we can find the closest point on the outline. Kind of a projection of the point from the div to the outline of the shape. This will require that I review some of the school geometry equations. 
- Aside from Claude explantaion, I review this in https://stackoverflow.com/questions/14307158/how-do-you-check-for-intersection-between-a-line-segment-and-a-line-ray-emanatin. Which Leads me to Ray Casting.
We know that we will have an intersection, our challenge is that we have to find the closest segment of the node shape to the Point from the div. 

## Challenge 2 — grab & raise the endpoint

What was actually causing the endpoint/anchor to sit under the node, and how did
you fix it (or what got in the way)?

## Trade-offs & things I'd do with more time

With the Ray casting we are creating an array that points to the vartex of the shape, nevertheless, the handler still lives in the div, so we have to move the handler to the vertex of the shape. This creates two problems: 
- We cannot grab the end of the edge (the arrow), which makes it hard to move an existing edge arroud. 
- When we move the edge and we are in edit mode, the edge will not appear on the vertex of the shape, as the handler still lives in the div, and the edge will be drawn from the div to the vertex of the shape. That's not a good UI.

Additionally, the arrow are not perpendicular to the vertex of the shape. This will also be a nice to have for the UI to have a perfect connection between the edge and the shape.




## How I used AI tools (if at all)

Mostly I have used AI for two things: 
- To get an understanding of the project, how does react flow work, different functions, and how to use them.
- Get familiar with the state from react flow, and how to use it to get the information I need to solve the challenges.
- Generate code snippets and explanations to help implement the solutions.
- Implement the solution once I knew in which direction should I go.